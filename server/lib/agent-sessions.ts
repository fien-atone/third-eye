/**
 * Agent session parser — reads per-agent JSONL transcripts emitted by
 * Claude Code and aggregates them into "one row per agent invocation"
 * with decomposed token usage, role, duration, and tool usage.
 *
 * Two sources, both JSONL:
 *   1. Subagent sessions spawned inside a Claude Code session:
 *        ~/.claude/projects/<project-key>/<session-uuid>/subagents/agent-<aid>.jsonl
 *      Optional sibling `agent-<aid>.meta.json` carries the parent-side
 *      description (Task tool `description` arg).
 *
 *   2. Task-tool outputs from background/foreground invocations:
 *        /private/tmp/claude-501/<project-key>/<session-uuid>/tasks/<taskid>.output
 *      (Linux path varies — we glob the platform equivalent too.)
 *
 * Why both: the subagent stream is the authoritative per-role trace
 * (includes meta description), the task stream covers one-shot Agent()
 * calls that may not land in the subagents/ directory depending on
 * Claude Code version. We dedupe by (source, project, agent_id) so a
 * file appearing in both locations doesn't double-count.
 *
 * Streaming dedup: Claude Code writes each streamed chunk as its own
 * assistant message. If you naïvely sum every `usage` block you get
 * ~2x overcount. Keep the LAST usage per requestId — the finalised
 * message has the same id as its partials and contains the cumulative
 * tally.
 *
 * Role detection — intentionally conservative. Three tiers by
 * confidence:
 *   - 'meta'    — meta.json description starts with "<role>:" prefix
 *   - 'prompt'  — regex "You are the <role>" in first user turn
 *   - 'unknown' — no reliable signal; never guess from keywords
 * This is deliberately project-agnostic (unlike the prototype script
 * which had hardcoded keywords for one specific codebase). For role
 * data in projects without either signal, the widget simply shows
 * "unknown" and the user can see the raw description to disambiguate.
 */

import { readdir, readFile, stat } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { homedir, platform } from 'os'
import { calculateCost } from './models.js'

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export type AgentSessionRow = {
  agent_id: string
  source: 'subagent' | 'task'
  project: string
  ts_start: string
  ts_start_epoch: number
  duration_s: number
  role: string
  role_confidence: 'meta' | 'prompt' | 'unknown'
  description: string
  model: string           // most common model seen in this session
  input_tokens: number
  cache_create_tokens: number
  cache_read_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number
  api_calls: number
  tool_uses: number
  tools_json: string      // JSON: {"Edit": 12, "Read": 34}
}

type Usage = {
  input_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  output_tokens?: number
}

// ──────────────────────────────────────────────────────────────────────
// File discovery
// ──────────────────────────────────────────────────────────────────────

function getClaudeProjectsDir(): string {
  return process.env['CLAUDE_CONFIG_DIR']
    ? join(process.env['CLAUDE_CONFIG_DIR'] as string, 'projects')
    : join(homedir(), '.claude', 'projects')
}

/** Base dir for task output streams. macOS/Linux use /private/tmp/claude-<uid>/
 *  (the UID varies — we probe for the current user's prefix). */
function getTaskBaseDirs(): string[] {
  if (platform() === 'win32') return []
  // Best effort: /private/tmp/claude-<uid>/ on macOS, /tmp/claude-<uid>/ on Linux
  const uid = (process.getuid?.() ?? 501).toString()
  return [
    `/private/tmp/claude-${uid}`,
    `/tmp/claude-${uid}`,
  ]
}

async function listDir(p: string): Promise<string[]> {
  try { return await readdir(p) } catch { return [] }
}

async function isDir(p: string): Promise<boolean> {
  const s = await stat(p).catch(() => null)
  return s?.isDirectory() ?? false
}

/** Yields `{ project, sessionDir }` tuples discovered by scanning the
 *  Claude Code projects folder (one level deep). */
async function* discoverProjectSessions(): AsyncGenerator<{ project: string; sessionDir: string }> {
  const projectsDir = getClaudeProjectsDir()
  for (const proj of await listDir(projectsDir)) {
    const projDir = join(projectsDir, proj)
    if (!(await isDir(projDir))) continue
    for (const sess of await listDir(projDir)) {
      const sessDir = join(projDir, sess)
      if (await isDir(sessDir)) yield { project: proj, sessionDir: sessDir }
    }
  }
}

/** Yields `{ project, sessionDir }` tuples from task-output dirs. */
async function* discoverTaskSessions(): AsyncGenerator<{ project: string; sessionDir: string }> {
  for (const base of getTaskBaseDirs()) {
    if (!(await isDir(base))) continue
    for (const proj of await listDir(base)) {
      const projDir = join(base, proj)
      if (!(await isDir(projDir))) continue
      for (const sess of await listDir(projDir)) {
        const sessDir = join(projDir, sess)
        if (await isDir(sessDir)) yield { project: proj, sessionDir: sessDir }
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// Role detection
// ──────────────────────────────────────────────────────────────────────

const META_ROLE_PREFIX = /^([a-z][a-z0-9_-]{1,30})\s*:/i
const PROMPT_ROLE_RE = /You are the\s+([A-Za-z][A-Za-z0-9_-]{1,30})/

export type DetectedRole = { role: string; confidence: 'meta' | 'prompt' | 'unknown' }

export function detectRole(metaDesc: string | null, firstUserText: string | null): DetectedRole {
  if (metaDesc) {
    const m = metaDesc.match(META_ROLE_PREFIX)
    if (m) return { role: m[1].toLowerCase(), confidence: 'meta' }
  }
  if (firstUserText) {
    const m = firstUserText.match(PROMPT_ROLE_RE)
    if (m) return { role: m[1].toLowerCase(), confidence: 'prompt' }
  }
  return { role: 'unknown', confidence: 'unknown' }
}

// ──────────────────────────────────────────────────────────────────────
// JSONL parsing — one file → one AgentSessionRow
// ──────────────────────────────────────────────────────────────────────

/** Parse a JSONL agent transcript. Returns null if the file yields
 *  no billable tokens (empty / corrupt / synthetic). */
export async function parseAgentFile(
  filePath: string,
  opts: { source: 'subagent' | 'task'; project: string; metaDesc?: string | null }
): Promise<AgentSessionRow | null> {
  let content: string
  try { content = await readFile(filePath, 'utf-8') } catch { return null }

  // requestId → last usage wins (streaming dedup)
  const requestUsage = new Map<string, Usage>()
  // requestId → model seen (for cost calc & display)
  const requestModel = new Map<string, string>()
  const toolCounts = new Map<string, number>()
  let firstUserText: string | null = null
  let firstTs: string | null = null
  let lastTs: string | null = null

  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    let obj: unknown
    try { obj = JSON.parse(line) } catch { continue }
    if (!obj || typeof obj !== 'object') continue
    const ev = obj as Record<string, unknown>

    const ts = typeof ev.timestamp === 'string' ? ev.timestamp : null
    if (ts) {
      if (!firstTs) firstTs = ts
      lastTs = ts
    }

    // First user message — used for role detection + description fallback
    if (firstUserText === null && ev.type === 'user') {
      const msg = ev.message as { content?: unknown } | undefined
      if (msg) {
        const c = msg.content
        if (typeof c === 'string' && c.trim().length > 0) firstUserText = c
        else if (Array.isArray(c)) {
          for (const item of c as Array<{ type?: string; text?: string }>) {
            if (item.type === 'text' && typeof item.text === 'string') {
              firstUserText = item.text
              break
            }
          }
        }
      }
    }

    if (ev.type === 'assistant') {
      const msg = ev.message as { usage?: Usage; content?: unknown; model?: string } | undefined
      const rid = typeof ev.requestId === 'string' ? ev.requestId : null
      if (msg && rid) {
        if (msg.usage) requestUsage.set(rid, msg.usage)
        if (typeof msg.model === 'string') requestModel.set(rid, msg.model)
      }
      // Tool usage — count across ALL assistant events (tool_use blocks
      // appear in the final message, not partials, so double-counting
      // isn't a concern in practice)
      if (msg && Array.isArray(msg.content)) {
        for (const item of msg.content as Array<{ type?: string; name?: string }>) {
          if (item.type === 'tool_use' && typeof item.name === 'string') {
            toolCounts.set(item.name, (toolCounts.get(item.name) ?? 0) + 1)
          }
        }
      }
    }
  }

  // Sum deduped usage
  let input = 0, cacheCreate = 0, cacheRead = 0, output = 0
  for (const u of requestUsage.values()) {
    input += u.input_tokens ?? 0
    cacheCreate += u.cache_creation_input_tokens ?? 0
    cacheRead += u.cache_read_input_tokens ?? 0
    output += u.output_tokens ?? 0
  }
  const total = input + cacheCreate + cacheRead + output
  // Validity gate — empty or implausibly large (corrupt file)
  if (total <= 0 || total > 500_000_000) return null

  // Pick the most common model in the session (tie → last seen)
  const modelTally = new Map<string, number>()
  for (const m of requestModel.values()) modelTally.set(m, (modelTally.get(m) ?? 0) + 1)
  let model = ''
  let best = -1
  for (const [m, n] of modelTally) if (n > best) { best = n; model = m }

  // Cost via existing pricing system (LiteLLM-backed, caches writes/reads
  // separately — exactly the decomposition we need here).
  const cost = calculateCost(model, input, output, cacheCreate, cacheRead, 0, 'standard')

  // Duration (wall-clock, first→last timestamp)
  let durationS = 0
  if (firstTs && lastTs) {
    const a = Date.parse(firstTs), b = Date.parse(lastTs)
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) durationS = Math.round((b - a) / 1000)
  }

  // Agent id = filename stem
  const stem = basename(filePath)
    .replace(/\.output$/, '')
    .replace(/\.jsonl$/, '')
    .replace(/^agent-/, '')

  const metaDesc = opts.metaDesc ?? null
  const { role, confidence } = detectRole(metaDesc, firstUserText)

  // Description: meta.json takes priority; fall back to a cleaned first-user slice
  let description = metaDesc ?? ''
  if (!description && firstUserText) {
    for (const raw of firstUserText.split('\n')) {
      const l = raw.trim()
      if (l.length > 15 && !/^(Working dir|You are|Read your)/.test(l)) {
        description = l.replace(/[*#]/g, '').trim().slice(0, 200)
        break
      }
    }
    if (!description) description = firstUserText.slice(0, 120).replace(/\n/g, ' ')
  }

  const toolsObj: Record<string, number> = {}
  let toolUses = 0
  for (const [k, v] of toolCounts) { toolsObj[k] = v; toolUses += v }

  return {
    agent_id: stem,
    source: opts.source,
    project: opts.project,
    ts_start: firstTs ?? new Date().toISOString(),
    ts_start_epoch: firstTs ? Date.parse(firstTs) : Date.now(),
    duration_s: durationS,
    role,
    role_confidence: confidence,
    description,
    model,
    input_tokens: input,
    cache_create_tokens: cacheCreate,
    cache_read_tokens: cacheRead,
    output_tokens: output,
    total_tokens: total,
    cost_usd: cost,
    api_calls: requestUsage.size,
    tool_uses: toolUses,
    tools_json: JSON.stringify(toolsObj),
  }
}

// ──────────────────────────────────────────────────────────────────────
// Crawl everything, yielding one row per agent file
// ──────────────────────────────────────────────────────────────────────

/** Scan all known agent-session locations and yield parsed rows.
 *  Dedup by (source, project, agent_id) — if the same file surfaces in
 *  two passes (e.g. symlinked), the later one wins but the count is
 *  correct. */
export async function* scanAgentSessions(): AsyncGenerator<AgentSessionRow> {
  const seen = new Set<string>()

  for await (const { project, sessionDir } of discoverProjectSessions()) {
    const subDir = join(sessionDir, 'subagents')
    if (!(await isDir(subDir))) continue
    for (const f of await listDir(subDir)) {
      if (!f.startsWith('agent-') || !f.endsWith('.jsonl')) continue
      const key = `subagent:${project}:${f}`
      if (seen.has(key)) continue
      seen.add(key)
      const fp = join(subDir, f)
      // Sibling meta.json (if present) carries the Task tool description
      const metaFp = fp.replace(/\.jsonl$/, '.meta.json')
      let metaDesc: string | null = null
      try {
        const raw = await readFile(metaFp, 'utf-8')
        const parsed = JSON.parse(raw) as { description?: string }
        if (typeof parsed.description === 'string') metaDesc = parsed.description
      } catch { /* no meta file — leave null */ }
      const row = await parseAgentFile(fp, { source: 'subagent', project, metaDesc })
      if (row) yield row
    }
  }

  for await (const { project, sessionDir } of discoverTaskSessions()) {
    const tasksDir = join(sessionDir, 'tasks')
    if (!(await isDir(tasksDir))) continue
    for (const f of await listDir(tasksDir)) {
      if (!f.endsWith('.output')) continue
      const key = `task:${project}:${f}`
      if (seen.has(key)) continue
      seen.add(key)
      const row = await parseAgentFile(join(tasksDir, f), { source: 'task', project })
      if (row) yield row
    }
  }
}
// silence unused import if dirname ever unused — harmless no-op
void dirname
