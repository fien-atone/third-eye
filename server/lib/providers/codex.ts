/*
 * Adapted from CodeBurn (https://github.com/AgentSeal/codeburn)
 * Original Copyright (c) 2025 AgentSeal — MIT License
 * See webapp/THIRD_PARTY_NOTICES.md for full license text.
 */

import { readdir, readFile, stat } from 'fs/promises'
import { basename, join } from 'path'
import { homedir } from 'os'

import { calculateCost } from '../models.js'
import type { Provider, SessionSource, SessionParser, ParsedProviderCall } from './types.js'

const modelDisplayNames: Record<string, string> = {
  'gpt-5.3-codex': 'GPT-5.3 Codex',
  'gpt-5.4-mini': 'GPT-5.4 Mini',
  'gpt-5.4': 'GPT-5.4',
  'gpt-5': 'GPT-5',
  'gpt-4o-mini': 'GPT-4o Mini',
  'gpt-4o': 'GPT-4o',
}

const toolNameMap: Record<string, string> = {
  exec_command: 'Bash',
  read_file: 'Read',
  write_file: 'Edit',
  apply_diff: 'Edit',
  apply_patch: 'Edit',
  spawn_agent: 'Agent',
  close_agent: 'Agent',
  wait_agent: 'Agent',
  read_dir: 'Glob',
}

type CodexEntry = {
  type: string
  timestamp?: string
  payload?: {
    type?: string
    role?: string
    cwd?: string
    model_provider?: string
    originator?: string
    session_id?: string
    model?: string
    name?: string
    content?: Array<{ type?: string; text?: string }>
    info?: {
      model?: string
      model_name?: string
      last_token_usage?: CodexTokenUsage
      total_token_usage?: CodexTokenUsage
    }
  }
}

type CodexTokenUsage = {
  input_tokens?: number
  cached_input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
  total_tokens?: number
}

function getCodexDir(override?: string): string {
  return override ?? process.env['CODEX_HOME'] ?? join(homedir(), '.codex')
}

function sanitizeProject(cwd: string): string {
  return cwd.replace(/^\//, '').replace(/\//g, '-')
}

async function readFirstLine(filePath: string): Promise<CodexEntry | null> {
  try {
    const content = await readFile(filePath, 'utf-8')
    const line = content.split('\n')[0]
    if (!line?.trim()) return null
    return JSON.parse(line) as CodexEntry
  } catch {
    return null
  }
}

async function isValidCodexSession(filePath: string): Promise<{ valid: boolean; meta?: CodexEntry }> {
  const entry = await readFirstLine(filePath)
  if (!entry) return { valid: false }
  // Originator naming changed across Codex versions:
  //   - codex_vscode  (old VSCode extension, lowercase)
  //   - codex_cli     (CLI)
  //   - Codex Desktop (newer Desktop app, capital C with a space)
  // Accept anything starting with "codex" regardless of case so a
  // future originator naming change doesn't silently drop a month
  // of session data again.
  const valid = entry.type === 'session_meta' &&
    typeof entry.payload?.originator === 'string' &&
    entry.payload.originator.toLowerCase().startsWith('codex')
  return { valid, meta: valid ? entry : undefined }
}

async function discoverSessionsInDir(codexDir: string): Promise<SessionSource[]> {
  const sessionsDir = join(codexDir, 'sessions')
  const sources: SessionSource[] = []

  let years: string[]
  try {
    years = await readdir(sessionsDir)
  } catch {
    return sources
  }

  for (const year of years) {
    if (!/^\d{4}$/.test(year)) continue
    const yearDir = join(sessionsDir, year)
    const months = await readdir(yearDir).catch(() => [] as string[])

    for (const month of months) {
      if (!/^\d{2}$/.test(month)) continue
      const monthDir = join(yearDir, month)
      const days = await readdir(monthDir).catch(() => [] as string[])

      for (const day of days) {
        if (!/^\d{2}$/.test(day)) continue
        const dayDir = join(monthDir, day)
        const files = await readdir(dayDir).catch(() => [] as string[])

        for (const file of files) {
          if (!file.startsWith('rollout-') || !file.endsWith('.jsonl')) continue
          const filePath = join(dayDir, file)
          const s = await stat(filePath).catch(() => null)
          if (!s?.isFile()) continue

          const { valid, meta } = await isValidCodexSession(filePath)
          if (!valid || !meta) continue

          const cwd = meta.payload?.cwd ?? 'unknown'
          sources.push({ path: filePath, project: sanitizeProject(cwd), provider: 'codex' })
        }
      }
    }
  }

  return sources
}

/** Codex carries the model name in different places depending on
 *  version and event type:
 *    - session_meta.payload.model       — legacy, removed in newer
 *      Codex (Desktop). Empty there now.
 *    - turn_context.payload.model       — current location, written
 *      once per turn. Tracked into sessionModel by the parser loop.
 *    - event_msg.payload.info.model     — legacy event_msg shape.
 *    - event_msg.payload.info.model_name — alt legacy.
 *    - event_msg.payload.model          — defensive fallback for
 *      any future shape that drops the .info nesting.
 *  Default 'gpt-5' is the last-resort fallback so cost math still
 *  runs against a known pricing row instead of crashing. */
function resolveModel(info: CodexEntry['payload'], sessionModel?: string): string {
  return info?.info?.model
    ?? info?.info?.model_name
    ?? (info as { model?: string } | undefined)?.model
    ?? sessionModel
    ?? 'gpt-5'
}

function createParser(source: SessionSource, seenKeys: Set<string>): SessionParser {
  return {
    async *parse(): AsyncGenerator<ParsedProviderCall> {
      let content: string
      try {
        content = await readFile(source.path, 'utf-8')
      } catch {
        return
      }

      const lines = content.split('\n').filter(l => l.trim())
      let sessionModel: string | undefined
      let sessionId = ''
      let prevCumulativeTotal = 0
      let prevInput = 0
      let prevCached = 0
      let prevOutput = 0
      let prevReasoning = 0
      let pendingTools: string[] = []
      let pendingUserMessage = ''

      for (const line of lines) {
        let entry: CodexEntry
        try {
          entry = JSON.parse(line) as CodexEntry
        } catch {
          continue
        }

        if (entry.type === 'session_meta') {
          sessionId = entry.payload?.session_id ?? basename(source.path, '.jsonl')
          // Older Codex versions wrote the model into session_meta;
          // newer ones (Desktop app) don't, and a turn_context entry
          // carries it instead. Take whichever's present.
          sessionModel = entry.payload?.model
          continue
        }

        // turn_context arrives once per turn in current Codex; it
        // carries payload.model = 'gpt-5.5' (or similar). Track it so
        // subsequent token_count events use the correct model for
        // cost math instead of falling back to the 'gpt-5' default.
        if (entry.type === 'turn_context') {
          const turnModel = (entry.payload as { model?: string } | undefined)?.model
          if (typeof turnModel === 'string' && turnModel.length > 0) {
            sessionModel = turnModel
          }
          continue
        }

        if (entry.type === 'response_item' && entry.payload?.type === 'function_call') {
          const rawName = entry.payload.name ?? ''
          pendingTools.push(toolNameMap[rawName] ?? rawName)
          continue
        }

        if (entry.type === 'response_item' && entry.payload?.type === 'message' && entry.payload?.role === 'user') {
          const texts = (entry.payload.content ?? [])
            .filter(c => c.type === 'input_text')
            .map(c => c.text ?? '')
            .filter(Boolean)
          if (texts.length > 0) pendingUserMessage = texts.join(' ')
          continue
        }

        if (entry.type === 'event_msg' && entry.payload?.type === 'token_count') {
          const info = entry.payload.info
          if (!info) continue

          const cumulativeTotal = info.total_token_usage?.total_tokens ?? 0
          if (cumulativeTotal > 0 && cumulativeTotal === prevCumulativeTotal) continue
          prevCumulativeTotal = cumulativeTotal

          const last = info.last_token_usage
          let inputTokens = 0
          let cachedInputTokens = 0
          let outputTokens = 0
          let reasoningTokens = 0

          if (last) {
            inputTokens = last.input_tokens ?? 0
            cachedInputTokens = last.cached_input_tokens ?? 0
            outputTokens = last.output_tokens ?? 0
            reasoningTokens = last.reasoning_output_tokens ?? 0
          } else if (cumulativeTotal > 0) {
            const total = info.total_token_usage
            if (!total) continue
            inputTokens = (total.input_tokens ?? 0) - prevInput
            cachedInputTokens = (total.cached_input_tokens ?? 0) - prevCached
            outputTokens = (total.output_tokens ?? 0) - prevOutput
            reasoningTokens = (total.reasoning_output_tokens ?? 0) - prevReasoning
          }

          if (!last) {
            const total = info.total_token_usage
            if (total) {
              prevInput = total.input_tokens ?? 0
              prevCached = total.cached_input_tokens ?? 0
              prevOutput = total.output_tokens ?? 0
              prevReasoning = total.reasoning_output_tokens ?? 0
            }
          }

          const totalTokens = inputTokens + cachedInputTokens + outputTokens + reasoningTokens
          if (totalTokens === 0) continue

          // OpenAI includes cached tokens inside input_tokens; Anthropic does not.
          // Normalize to Anthropic semantics: inputTokens = non-cached only.
          const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens)

          const model = resolveModel(entry.payload, sessionModel)
          const timestamp = entry.timestamp ?? ''
          const dedupKey = `codex:${source.path}:${timestamp}:${cumulativeTotal}`

          if (seenKeys.has(dedupKey)) continue
          seenKeys.add(dedupKey)

          const costUSD = calculateCost(
            model,
            uncachedInputTokens,
            outputTokens + reasoningTokens,
            0,
            cachedInputTokens,
            0,
          )

          yield {
            provider: 'codex',
            model,
            inputTokens: uncachedInputTokens,
            outputTokens,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: cachedInputTokens,
            cachedInputTokens,
            reasoningTokens,
            webSearchRequests: 0,
            costUSD,
            tools: pendingTools,
            timestamp,
            speed: 'standard',
            deduplicationKey: dedupKey,
            userMessage: pendingUserMessage,
            sessionId,
          }

          pendingTools = []
          pendingUserMessage = ''
        }
      }
    },
  }
}

export function createCodexProvider(codexDir?: string): Provider {
  const dir = getCodexDir(codexDir)

  return {
    name: 'codex',
    displayName: 'Codex',

    modelDisplayName(model: string): string {
      for (const [key, name] of Object.entries(modelDisplayNames)) {
        if (model.startsWith(key)) return name
      }
      return model
    },

    toolDisplayName(rawTool: string): string {
      return toolNameMap[rawTool] ?? rawTool
    },

    async discoverSessions(): Promise<SessionSource[]> {
      return discoverSessionsInDir(dir)
    },

    createSessionParser(source: SessionSource, seenKeys: Set<string>): SessionParser {
      return createParser(source, seenKeys)
    },
  }
}

export const codex = createCodexProvider()

// ──────────────────────────────────────────────────────────────────────
// Rate-limits snapshot (separate from the regular per-call ingest)
// ──────────────────────────────────────────────────────────────────────

/** Account-level snapshot of the user's Codex / ChatGPT plan usage,
 *  pulled out of the rate_limits payload that Codex includes in
 *  every token_count event. Anthropic's API doesn't have an
 *  equivalent — this is OpenAI/Codex-only. */
export type CodexPlanSnapshot = {
  planType: string | null              // 'free' | 'ChatGPT Plus' | 'Pro' | 'Enterprise' | …
  limitId: string | null               // server-side limit identifier
  limitName: string | null             // human-readable label, e.g. '5 hour limit'
  primary: CodexLimitWindow | null     // main rate window
  secondary: CodexLimitWindow | null   // optional second window (some plans have both)
  credits: number | null               // remaining credits on paid plans, null on free
  rateLimitReachedType: string | null  // non-null when user hit a limit recently
  capturedAt: string                   // ISO of the token_count event we got this from
}

export type CodexLimitWindow = {
  usedPercent: number      // 0–100
  windowMinutes: number    // duration of the rolling window
  resetsAt: number         // unix epoch SECONDS when the window resets
}

/** Walk the latest Codex rollout file and return the most recent
 *  rate_limits payload. We don't aggregate across files because
 *  rate_limits are point-in-time account state — only the absolute
 *  latest sample is meaningful. Returns null when no Codex sessions
 *  exist or none of them carry rate_limits. */
export async function getLatestCodexPlanSnapshot(codexDir?: string): Promise<CodexPlanSnapshot | null> {
  const root = join(getCodexDir(codexDir), 'sessions')
  // Walk year/month/day descending to find the freshest session file.
  let candidates: { path: string; mtime: number }[] = []
  let years: string[] = []
  try { years = await readdir(root) } catch { return null }
  // Sort newest-first lexicographically (works because 4-digit year).
  years.sort((a, b) => b.localeCompare(a))
  for (const year of years) {
    if (!/^\d{4}$/.test(year)) continue
    const yearDir = join(root, year)
    const months = (await readdir(yearDir).catch(() => [] as string[])).sort((a, b) => b.localeCompare(a))
    for (const month of months) {
      if (!/^\d{2}$/.test(month)) continue
      const monthDir = join(yearDir, month)
      const days = (await readdir(monthDir).catch(() => [] as string[])).sort((a, b) => b.localeCompare(a))
      for (const day of days) {
        if (!/^\d{2}$/.test(day)) continue
        const dayDir = join(monthDir, day)
        const files = (await readdir(dayDir).catch(() => [] as string[])).filter(
          f => f.startsWith('rollout-') && f.endsWith('.jsonl'),
        )
        for (const f of files) {
          const fp = join(dayDir, f)
          const s = await stat(fp).catch(() => null)
          if (s?.isFile()) candidates.push({ path: fp, mtime: s.mtimeMs })
        }
        if (candidates.length > 0) break  // found something today; stop digging
      }
      if (candidates.length > 0) break
    }
    if (candidates.length > 0) break
  }
  if (candidates.length === 0) return null
  // Pick the newest by mtime to handle multiple rollouts on the same day.
  candidates.sort((a, b) => b.mtime - a.mtime)

  // Read each candidate from newest, scan for the LAST rate_limits
  // entry. We only need the freshest file unless it lacks rate_limits
  // (rare — practically every token_count event carries them).
  for (const c of candidates) {
    const text = await readFile(c.path, 'utf-8').catch(() => '')
    if (!text) continue
    let lastSnapshot: CodexPlanSnapshot | null = null
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      let entry: Record<string, unknown>
      try { entry = JSON.parse(line) } catch { continue }
      const payload = (entry as { payload?: Record<string, unknown> }).payload
      const rl = payload && (payload as { rate_limits?: Record<string, unknown> }).rate_limits
      if (!rl || typeof rl !== 'object') continue
      const ts = typeof entry.timestamp === 'string' ? entry.timestamp : new Date().toISOString()
      lastSnapshot = {
        planType: (rl.plan_type as string | null) ?? null,
        limitId: (rl.limit_id as string | null) ?? null,
        limitName: (rl.limit_name as string | null) ?? null,
        primary: rl.primary ? toWindow(rl.primary as Record<string, unknown>) : null,
        secondary: rl.secondary ? toWindow(rl.secondary as Record<string, unknown>) : null,
        credits: typeof rl.credits === 'number' ? rl.credits : null,
        rateLimitReachedType: (rl.rate_limit_reached_type as string | null) ?? null,
        capturedAt: ts,
      }
    }
    if (lastSnapshot) return lastSnapshot
  }
  return null
}

function toWindow(o: Record<string, unknown>): CodexLimitWindow {
  return {
    usedPercent: typeof o.used_percent === 'number' ? o.used_percent : 0,
    windowMinutes: typeof o.window_minutes === 'number' ? o.window_minutes : 0,
    resetsAt: typeof o.resets_at === 'number' ? o.resets_at : 0,
  }
}
