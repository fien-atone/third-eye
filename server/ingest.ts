import { parseAllSessions } from './lib/parser.ts'
import { loadPricing } from './lib/models.ts'
import { CATEGORY_LABELS } from './lib/types.ts'
import type { ClassifiedTurn, ParsedApiCall, DateRange } from './lib/types.ts'
import { randomUUID } from 'crypto'
import { createInterface } from 'readline'
import { readdir, readFile, stat } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { db, setMeta, truncateAll, type CallRow } from './db.ts'

function shortenProjectLabel(key: string): string {
  return key.replace(/^-?Users-[^-]+-/, '~/').replace(/-/g, '/')
}

function isEphemeralCoworkKey(key: string): boolean {
  // Cowork/Desktop ephemeral task folders look like "-sessions-<adjective>-<adjective>-<noun>"
  return /^-sessions-[a-z]+-[a-z]+-[a-z]+$/.test(key)
}

/** Extract a human label from the first user message (truncated). Strips newlines. */
function labelFromText(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return clean.slice(0, max - 1).trimEnd() + '…'
}

/** For ephemeral Cowork projects, look up the first user message in audit.jsonl. */
async function resolveCoworkLabel(projectKey: string): Promise<string | null> {
  if (!isEphemeralCoworkKey(projectKey)) return null
  const base = join(homedir(), 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions')
  let outerDirs: string[] = []
  try { outerDirs = await readdir(base) } catch { return null }

  for (const outer of outerDirs) {
    const mid = join(base, outer)
    let midEntries: string[] = []
    try { midEntries = await readdir(mid) } catch { continue }
    for (const m of midEntries) {
      const localParent = join(mid, m)
      let locals: string[] = []
      try { locals = await readdir(localParent) } catch { continue }
      for (const l of locals) {
        if (!l.startsWith('local_')) continue
        const localDir = join(localParent, l)
        const projectPath = join(localDir, '.claude', 'projects', projectKey)
        const s = await stat(projectPath).catch(() => null)
        if (!s?.isDirectory()) continue
        // Found matching local_<uuid>. Read audit.jsonl for first user message.
        const auditPath = join(localDir, 'audit.jsonl')
        const content = await readFile(auditPath, 'utf-8').catch(() => null)
        if (!content) return null
        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          try {
            const entry = JSON.parse(line) as { type?: string; message?: { role?: string; content?: unknown } }
            if (entry.type !== 'user' || entry.message?.role !== 'user') continue
            const c = entry.message.content
            if (typeof c === 'string' && c.trim()) return labelFromText(c)
            if (Array.isArray(c)) {
              const text = (c as Array<{ type?: string; text?: string }>)
                .filter(b => b.type === 'text' && typeof b.text === 'string')
                .map(b => b.text!)
                .join(' ')
              if (text.trim()) return labelFromText(text)
            }
          } catch {}
        }
        return null
      }
    }
  }
  return null
}

async function upsertProjects(keys: Set<string>) {
  const d = db()
  const getExisting = d.prepare('SELECT id, key, label FROM projects WHERE key = ?')
  const insert = d.prepare('INSERT INTO projects (id, key, label) VALUES (?, ?, ?)')
  const updateLabel = d.prepare('UPDATE projects SET label = ? WHERE key = ?')

  for (const k of keys) {
    const existing = getExisting.get(k) as { id: string; key: string; label: string | null } | undefined
    const baseLabel = shortenProjectLabel(k)
    // Cowork ephemeral: upgrade label to the first user message, if we can find it
    const coworkLabel = await resolveCoworkLabel(k)
    const desiredLabel = coworkLabel ?? baseLabel

    if (!existing) {
      insert.run(randomUUID(), k, desiredLabel)
    } else if (coworkLabel && existing.label !== desiredLabel) {
      // Re-ingest can now resolve a label that wasn't available before — update it
      updateLabel.run(desiredLabel, k)
    }
  }
}

const SHORT_MODEL_MAP: Record<string, string> = {
  'claude-opus-4-6': 'Opus 4.6',
  'claude-opus-4-5': 'Opus 4.5',
  'claude-opus-4-1': 'Opus 4.1',
  'claude-opus-4': 'Opus 4',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-sonnet-4-5': 'Sonnet 4.5',
  'claude-sonnet-4': 'Sonnet 4',
  'claude-3-7-sonnet': 'Sonnet 3.7',
  'claude-3-5-sonnet': 'Sonnet 3.5',
  'claude-haiku-4-5': 'Haiku 4.5',
  'claude-3-5-haiku': 'Haiku 3.5',
  'gpt-4o-mini': 'GPT-4o Mini',
  'gpt-4o': 'GPT-4o',
  'gpt-5.4-mini': 'GPT-5.4 Mini',
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.3-codex': 'GPT-5.3 Codex',
  'gpt-5': 'GPT-5',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
}

function shortModel(model: string): string {
  const c = model.replace(/@.*$/, '').replace(/-\d{8}$/, '')
  for (const [k, v] of Object.entries(SHORT_MODEL_MAP)) if (c.startsWith(k)) return v
  return c
}

export type IngestStats = {
  durationMs: number
  inserted: number
  skipped: number
  total: number
  projects: number
  mode: string
  range?: { start: string; end: string }
}

export function parseSince(expr: string): Date {
  const m = expr.trim().match(/^(\d+)\s*([smhd])$/i)
  if (!m) throw new Error(`invalid --since expression: "${expr}" (use e.g. 30m, 24h, 7d)`)
  const n = parseInt(m[1], 10)
  const unit = m[2].toLowerCase()
  const mult = unit === 's' ? 1e3 : unit === 'm' ? 60e3 : unit === 'h' ? 3600e3 : 86400e3
  return new Date(Date.now() - n * mult)
}

export type IngestOpts = { since?: string; full?: boolean; rebuild?: boolean }

export async function runIngest(opts: IngestOpts = {}): Promise<IngestStats> {
  const t0 = Date.now()

  let mode = 'full'
  let wiped: { calls: number; projects: number } | undefined
  if (opts.rebuild) {
    wiped = truncateAll()
    mode = 'rebuild'
    console.log(`[rebuild] wiped ${wiped.calls} calls, ${wiped.projects} projects`)
  }

  await loadPricing()

  let range: DateRange | undefined
  if (opts.since && !opts.full && !opts.rebuild) {
    const start = parseSince(opts.since)
    range = { start, end: new Date() }
    mode = `since ${opts.since}`
  }

  const projects = await parseAllSessions(range)

  const d = db()
  const insert = d.prepare(`
    INSERT INTO api_calls (
      dedup_key, ts, ts_epoch, provider, model, model_short, project, session_id,
      category, input_tokens, output_tokens, cache_read, cache_write, web_search, cost_usd, speed,
      git_branch, cc_version, has_plan_mode, has_todo_write, file_count
    ) VALUES (
      @dedup_key, @ts, @ts_epoch, @provider, @model, @model_short, @project, @session_id,
      @category, @input_tokens, @output_tokens, @cache_read, @cache_write, @web_search, @cost_usd, @speed,
      @git_branch, @cc_version, @has_plan_mode, @has_todo_write, @file_count
    )
    ON CONFLICT(dedup_key) DO UPDATE SET
      ts=excluded.ts, ts_epoch=excluded.ts_epoch, cost_usd=excluded.cost_usd,
      category=excluded.category, model_short=excluded.model_short,
      git_branch=excluded.git_branch, cc_version=excluded.cc_version,
      has_plan_mode=excluded.has_plan_mode, has_todo_write=excluded.has_todo_write,
      file_count=excluded.file_count
  `)
  const deleteEvents = d.prepare('DELETE FROM tool_events WHERE dedup_key = ?')
  const insertEvent = d.prepare('INSERT INTO tool_events (dedup_key, ts_epoch, project, kind, value, cost_usd) VALUES (?, ?, ?, ?, ?, ?)')

  let inserted = 0
  let skipped = 0
  type RowWithEvents = CallRow & {
    git_branch: string | null
    cc_version: string | null
    has_plan_mode: number
    has_todo_write: number
    file_count: number
    _events: Array<{ kind: string; value: string }>
  }
  const rows: RowWithEvents[] = []

  for (const p of projects) {
    for (const s of p.sessions) {
      for (const turn of s.turns as ClassifiedTurn[]) {
        for (const call of turn.assistantCalls as ParsedApiCall[]) {
          if (!call.timestamp) { skipped++; continue }
          const ts_epoch = Date.parse(call.timestamp)
          if (isNaN(ts_epoch)) { skipped++; continue }
          const events: Array<{ kind: string; value: string }> = []
          for (const v of call.subagentTypes) events.push({ kind: 'subagent', value: v })
          for (const v of call.skills) events.push({ kind: 'skill', value: v })
          for (const v of call.files) events.push({ kind: 'file', value: v })
          for (const v of call.bashCommands) events.push({ kind: 'bash', value: v })
          for (const v of call.mcpTools) {
            const server = v.split('__')[1] ?? v
            events.push({ kind: 'mcp', value: server })
          }
          rows.push({
            dedup_key: call.deduplicationKey,
            ts: call.timestamp,
            ts_epoch,
            provider: call.provider,
            model: call.model,
            model_short: shortModel(call.model),
            project: p.project,
            session_id: turn.sessionId || s.sessionId,
            category: CATEGORY_LABELS[turn.category] ?? turn.category,
            input_tokens: call.usage.inputTokens,
            output_tokens: call.usage.outputTokens,
            cache_read: call.usage.cacheReadInputTokens,
            cache_write: call.usage.cacheCreationInputTokens,
            web_search: call.usage.webSearchRequests,
            cost_usd: call.costUSD,
            speed: call.speed,
            git_branch: call.gitBranch,
            cc_version: call.ccVersion,
            has_plan_mode: call.hasPlanMode ? 1 : 0,
            has_todo_write: call.hasTodoWrite ? 1 : 0,
            file_count: call.files.length,
            _events: events,
          })
        }
      }
    }
  }

  const tx = d.transaction((batch: RowWithEvents[]) => {
    for (const r of batch) {
      const { _events, ...row } = r
      insert.run(row)
      deleteEvents.run(r.dedup_key)
      // Cost attribution: split call cost evenly across its events (at most once per kind+value)
      const costPer = _events.length > 0 ? r.cost_usd / _events.length : 0
      for (const e of _events) {
        insertEvent.run(r.dedup_key, r.ts_epoch, r.project, e.kind, e.value, costPer)
      }
      inserted++
    }
  })
  tx(rows)

  await upsertProjects(new Set(rows.map(r => r.project)))

  setMeta('last_ingest_at', new Date().toISOString())
  setMeta('last_ingest_rows', String(rows.length))

  return {
    durationMs: Date.now() - t0,
    inserted,
    skipped,
    total: rows.length,
    projects: projects.length,
    mode,
    range: range ? { start: range.start.toISOString(), end: range.end.toISOString() } : undefined,
  }
}

type CliOpts = IngestOpts & { yes?: boolean }

function parseArgs(argv: string[]): CliOpts | 'help' {
  const opts: CliOpts = {}
  for (const a of argv) {
    if (a === '-h' || a === '--help') return 'help'
    if (a === '--full') opts.full = true
    else if (a === '--rebuild') opts.rebuild = true
    else if (a === '-y' || a === '--yes') opts.yes = true
    else if (a.startsWith('--since=')) opts.since = a.slice('--since='.length)
  }
  return opts
}

function usage() {
  console.log(`Usage: npm run ingest -- [options]

Options:
  --full           Rescan all session files (idempotent upsert; default)
  --since=<dur>    Only ingest entries newer than <dur>. Units: s, m, h, d
                   Examples: --since=1h, --since=24h, --since=7d, --since=30m
  --rebuild        DESTRUCTIVE: wipe the database, then run a full ingest.
                   Prompts for confirmation unless --yes is also given.
  -y, --yes        Skip the interactive confirmation for --rebuild.
                   Required in non-interactive shells (cron, CI).
  -h, --help       Show this help

Examples:
  npm run ingest                       # full rescan (safe, idempotent)
  npm run ingest -- --since=1h         # entries from the last hour
  npm run ingest -- --since=24h        # last 24h (typical hourly cron target)
  npm run ingest:rebuild               # wipe + reingest, with confirmation
  npm run ingest:rebuild -- --yes      # wipe + reingest, no prompt (cron-safe)
`)
}

async function confirmDestructive(): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error('refusing to --rebuild in a non-interactive shell without --yes.')
    console.error('add -y / --yes if you really mean it (cron, CI, scripts).')
    return false
  }
  console.log('')
  console.log('  WARNING: --rebuild will DELETE all rows from api_calls and projects')
  console.log('           and re-ingest from scratch. Existing project UUIDs will be')
  console.log('           regenerated, breaking any /#/project/<uuid> bookmarks.')
  console.log('')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer: string = await new Promise(resolve => {
    rl.question('  Type "rebuild" to confirm, anything else to cancel: ', resolve)
  })
  rl.close()
  console.log('')
  return answer.trim() === 'rebuild'
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')
if (isMain) {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed === 'help') { usage(); process.exit(0) }
  ;(async () => {
    if (parsed.rebuild && !parsed.yes) {
      const ok = await confirmDestructive()
      if (!ok) {
        console.log('cancelled.')
        process.exit(2)
      }
    }
    try {
      const stats = await runIngest(parsed)
      console.log(JSON.stringify(stats, null, 2))
      process.exit(0)
    } catch (err) {
      console.error(err)
      process.exit(1)
    }
  })()
}
