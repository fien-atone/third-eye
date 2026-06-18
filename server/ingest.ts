import { parseAllSessions } from './lib/parser.ts'
import { loadPricing, getShortModelName } from './lib/models.ts'
import { CATEGORY_LABELS } from './lib/types.ts'
import type { ClassifiedTurn, ParsedApiCall, DateRange } from './lib/types.ts'
import { randomUUID } from 'crypto'
import { createInterface } from 'readline'
import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { db, setMeta, truncateAll, type CallRow, type RebuildTargets } from './db.ts'
import { claudeDesktopSessionsDir } from './lib/claude-paths.ts'
import { getLatestCodexPlanSnapshot, aggregateCodexPlanDaily } from './lib/providers/codex.ts'
import { scanAgentSessions } from './lib/agent-sessions.ts'

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
  const base = claudeDesktopSessionsDir()
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

// Short model naming is now algorithmic — see getShortModelName in lib/models.ts.
// New Anthropic/OpenAI/Google releases resolve automatically without code changes.
const shortModel = getShortModelName

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

export type IngestOpts = {
  since?: string
  full?: boolean
  rebuild?: boolean
  /** Optional flags forwarded to truncateAll when `rebuild=true`.
   *  Lets the caller (UI / CLI) opt into wiping user-configured
   *  tables on top of the always-wiped telemetry. Ignored when
   *  rebuild is false. */
  rebuildTargets?: RebuildTargets
}

export async function runIngest(opts: IngestOpts = {}): Promise<IngestStats> {
  const t0 = Date.now()

  let mode = 'full'
  let wiped: { calls: number; projects: number } | undefined
  if (opts.rebuild) {
    wiped = truncateAll(opts.rebuildTargets ?? {})
    mode = 'rebuild'
    console.log(`[rebuild] wiped ${wiped.calls} calls, ${wiped.projects} projects (targets: ${JSON.stringify(opts.rebuildTargets ?? {})})`)
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
      git_branch, cc_version, has_plan_mode, has_todo_write, file_count, source_alias
    ) VALUES (
      @dedup_key, @ts, @ts_epoch, @provider, @model, @model_short, @project, @session_id,
      @category, @input_tokens, @output_tokens, @cache_read, @cache_write, @web_search, @cost_usd, @speed,
      @git_branch, @cc_version, @has_plan_mode, @has_todo_write, @file_count, @source_alias
    )
    ON CONFLICT(dedup_key) DO UPDATE SET
      ts=excluded.ts, ts_epoch=excluded.ts_epoch, cost_usd=excluded.cost_usd,
      category=excluded.category,
      -- include the raw model column too, not only model_short.
      -- When a parser fix changes how we resolve the model name
      -- (e.g. picking up a new Codex turn_context shape), re-ingest
      -- should refresh the raw value too — otherwise SQL queries
      -- grouping by model see stale values while the UI is correct.
      model=excluded.model, model_short=excluded.model_short,
      git_branch=excluded.git_branch, cc_version=excluded.cc_version,
      has_plan_mode=excluded.has_plan_mode, has_todo_write=excluded.has_todo_write,
      file_count=excluded.file_count,
      -- Refresh source_alias too: a row's alias can change if a
      -- re-ingest re-discovers the same JSONL under a new source
      -- (e.g. user moved ~/.claude to ~/.claude-invent, then ran
      -- a re-ingest — the JSONLs are the same on disk, so dedup_key
      -- matches, but the source alias is different).
      source_alias=excluded.source_alias
  `)
  const deleteEvents = d.prepare('DELETE FROM tool_events WHERE dedup_key = ?')
  const insertEvent = d.prepare('INSERT INTO tool_events (dedup_key, ts_epoch, project, kind, value, cost_usd, source_alias) VALUES (?, ?, ?, ?, ?, ?, ?)')

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
            source_alias: s.sourceAlias ?? 'default',
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
        insertEvent.run(r.dedup_key, r.ts_epoch, r.project, e.kind, e.value, costPer, r.source_alias)
      }
      inserted++
    }
  })
  tx(rows)

  await upsertProjects(new Set(rows.map(r => r.project)))

  // ── Agent-session telemetry ──────────────────────────────────────
  // Separate pipeline: one row per spawned agent (subagent JSONL or
  // Task tool output). Idempotent upsert by (source, project, agent_id).
  // Runs on every ingest regardless of --since; the set is small
  // (hundreds, not tens of thousands) and re-parsing is cheap.
  let agentRows = 0
  try {
    const agentInsert = d.prepare(`
      INSERT INTO agent_sessions (
        agent_id, source, project, ts_start, ts_start_epoch, duration_s,
        role, role_confidence, description, model,
        input_tokens, cache_create_tokens, cache_read_tokens, output_tokens,
        total_tokens, cost_usd, api_calls, tool_uses, tools_json,
        prompt_id, stop_reason
      ) VALUES (
        @agent_id, @source, @project, @ts_start, @ts_start_epoch, @duration_s,
        @role, @role_confidence, @description, @model,
        @input_tokens, @cache_create_tokens, @cache_read_tokens, @output_tokens,
        @total_tokens, @cost_usd, @api_calls, @tool_uses, @tools_json,
        @prompt_id, @stop_reason
      )
      ON CONFLICT(source, project, agent_id) DO UPDATE SET
        ts_start=excluded.ts_start, ts_start_epoch=excluded.ts_start_epoch,
        duration_s=excluded.duration_s, role=excluded.role,
        role_confidence=excluded.role_confidence, description=excluded.description,
        model=excluded.model,
        input_tokens=excluded.input_tokens,
        cache_create_tokens=excluded.cache_create_tokens,
        cache_read_tokens=excluded.cache_read_tokens,
        output_tokens=excluded.output_tokens,
        total_tokens=excluded.total_tokens,
        cost_usd=excluded.cost_usd,
        api_calls=excluded.api_calls,
        tool_uses=excluded.tool_uses,
        tools_json=excluded.tools_json,
        prompt_id=excluded.prompt_id,
        stop_reason=excluded.stop_reason
    `)
    const batch: Parameters<typeof agentInsert.run>[0][] = []
    for await (const ar of scanAgentSessions()) batch.push(ar as unknown as Parameters<typeof agentInsert.run>[0])
    const atx = d.transaction((rs: typeof batch) => { for (const r of rs) agentInsert.run(r) })
    atx(batch)
    agentRows = batch.length
  } catch (err) {
    console.error('[ingest] agent_sessions scan failed:', (err as Error).message)
  }

  setMeta('last_ingest_at', new Date().toISOString())
  setMeta('last_ingest_rows', String(rows.length))
  setMeta('last_ingest_agent_rows', String(agentRows))

  // Codex rate-limits snapshot — account-level state pulled out of
  // the latest token_count event. Stored as a singleton meta entry
  // (overwritten each ingest); kept around for any caller that wants
  // "the freshest sample regardless of day" (currently nothing — the
  // Today widget reads from codex_plan_daily below — but cheap to
  // maintain). Empty-string also written when null so a previously-
  // recorded snapshot doesn't linger after the user uninstalls Codex.
  try {
    const plan = await getLatestCodexPlanSnapshot()
    setMeta('codex_plan_latest', plan ? JSON.stringify(plan) : '')
  } catch (err) {
    console.warn('[ingest] codex plan snapshot failed:', (err as Error).message)
  }

  // Per-day plan-usage peaks — full rebuild every ingest. Drives
  // the Today-view widget so navigating to a past date shows that
  // day's peak, not the latest sample. We DELETE+INSERT under one
  // transaction so old days that no longer have backing rollouts
  // (rare — would mean the user pruned their ~/.codex/sessions tree)
  // disappear from the table cleanly.
  try {
    const rows = await aggregateCodexPlanDaily()
    const d = db()
    const tx = d.transaction((rs: typeof rows) => {
      d.prepare('DELETE FROM codex_plan_daily').run()
      const stmt = d.prepare(
        'INSERT INTO codex_plan_daily (day, primary_pct, secondary_pct, snapshot, by_plan_json, limit_hits_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      const now = new Date().toISOString()
      for (const r of rs) {
        stmt.run(
          r.day,
          r.primaryPct,
          r.secondaryPct,
          JSON.stringify(r.snapshot),
          JSON.stringify(r.byPlan),
          JSON.stringify({ plans: r.limitHitPlans, count: r.limitHitCount }),
          now,
        )
      }
    })
    tx(rows)
  } catch (err) {
    console.warn('[ingest] codex plan daily aggregate failed:', (err as Error).message)
  }

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
