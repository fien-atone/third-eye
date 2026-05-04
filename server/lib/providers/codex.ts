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

/** Account-level snapshot of the user's Codex / ChatGPT plan usage.
 *
 *  Composite shape — Codex emits TWO independent limit families in
 *  the same JSONL stream and a per-day summary needs both:
 *    • `limit_id="codex"` samples carry rolling windows (primary 5h,
 *      secondary 7d) with `used_percent`. Stored as primary/secondary.
 *    • `limit_id="premium"` samples carry `credits` (Plus / Pro
 *      overage pool), with primary/secondary always null.
 *  When credits are exhausted Codex CLI reports "limit reached" even
 *  if the 5h window is at 50% — so credits is the binding signal on
 *  paid plans, not the windows.
 *
 *  For per-day rows: primary/secondary hold the day's PEAK
 *  `used_percent` (worst-case window utilization), credits holds the
 *  LATEST premium sample of the day (current credit state at end of
 *  day, or close to it). `planType`, `limitId`, `capturedAt` come
 *  from the latest sample on that day. `rateLimitReachedType` is
 *  preserved when ANY sample on the day had it set (rare in practice
 *  — Codex doesn't seem to populate it currently). */
export type CodexPlanSnapshot = {
  planType: string | null              // 'free' | 'plus' | 'pro' | …
  /** Marks which limit family is the user-facing constraint. 'premium'
   *  when premium samples exist on the day (credits then tells the
   *  real story); 'codex' otherwise. */
  limitId: string | null
  limitName: string | null             // human-readable label, often null
  primary: CodexLimitWindow | null     // peak 5h-window utilization for the day
  secondary: CodexLimitWindow | null   // peak 7d-window utilization for the day
  credits: CodexCredits | null         // latest premium-credits state (paid plans only)
  rateLimitReachedType: string | null  // non-null if any sample on the day had it
  capturedAt: string                   // ISO of the latest sample on this day
}

export type CodexLimitWindow = {
  usedPercent: number      // 0–100
  windowMinutes: number    // duration of the rolling window
  resetsAt: number         // unix epoch SECONDS when the window resets
}

export type CodexCredits = {
  /** Plus / Pro plans set this false when the user has burned through
   *  their overage allowance — Codex CLI surfaces "limit reached" at
   *  this point, regardless of primary/secondary window state. */
  hasCredits: boolean | null
  /** Some plans (Enterprise / Edu) report unlimited credits. */
  unlimited: boolean | null
  /** Stringified balance. Codex stores it as a string ("0", "12500")
   *  rather than a number so very large numbers don't lose precision —
   *  pass through verbatim. */
  balance: string | null
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
      lastSnapshot = snapshotFromRateLimits(rl as Record<string, unknown>, ts)
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

/** Per-day peak rate-limit snapshot. The day key uses the Codex session
 *  directory layout (YYYY/MM/DD) — that's the same local-tz day the
 *  Today view URL is keyed on, so a /day/2026-05-03 lookup hits the
 *  matching row.
 *
 *  `byPlan` carries the peak primary % for each `plan_type` that was
 *  active during the day, computed from `limit_id="codex"` samples
 *  only. Drives the Dashboard history bar chart, where each plan
 *  becomes a distinctly-colored stacked segment. Single-plan days
 *  have one entry; days where the user toggled across plans/sessions
 *  ship multiple entries.
 *
 *  `limitHits` is the AUTHORITATIVE record of "you actually hit a
 *  cap". Codex doesn't ship a token_count event with used_percent=100
 *  when the server returns 429 — the recorded peak just stops at the
 *  last successful sample (often well below 100%). But it DOES emit
 *  an `event_msg.type=error` with `codex_error_info=usage_limit_exceeded`
 *  that says exactly that. We parse those and attribute each hit to
 *  the plan_type that was active at the moment (most recent
 *  preceding token_count in the same file). The widget renders a
 *  red marker on bars whose plan hit a limit that day, so the user
 *  sees "yes, that's where I got blocked" even when the bar reads
 *  66%. */
export type CodexPlanDailyRow = {
  day: string
  primaryPct: number
  secondaryPct: number
  byPlan: Record<string, number>
  /** Plans that hit a usage_limit_exceeded error during the day. */
  limitHitPlans: string[]
  /** Total count of usage_limit_exceeded events on the day across
   *  all plans — surfaced in the tooltip as a sanity check. */
  limitHitCount: number
  snapshot: CodexPlanSnapshot
}

function toCredits(c: unknown): CodexCredits | null {
  if (!c || typeof c !== 'object') return null
  const o = c as Record<string, unknown>
  // Codex sometimes ships a credits object with all-null fields on
  // free plans; keep it (null fields convey "no info" downstream)
  // rather than collapsing to a missing object, which would be
  // indistinguishable from "no premium sample at all".
  return {
    hasCredits: typeof o.has_credits === 'boolean' ? o.has_credits : null,
    unlimited: typeof o.unlimited === 'boolean' ? o.unlimited : null,
    balance: typeof o.balance === 'string' ? o.balance : null,
  }
}

function snapshotFromRateLimits(rl: Record<string, unknown>, capturedAt: string): CodexPlanSnapshot {
  return {
    planType: (rl.plan_type as string | null) ?? null,
    limitId: (rl.limit_id as string | null) ?? null,
    limitName: (rl.limit_name as string | null) ?? null,
    primary: rl.primary ? toWindow(rl.primary as Record<string, unknown>) : null,
    secondary: rl.secondary ? toWindow(rl.secondary as Record<string, unknown>) : null,
    credits: toCredits(rl.credits),
    rateLimitReachedType: (rl.rate_limit_reached_type as string | null) ?? null,
    capturedAt,
  }
}

/** Internal: one normalized rate_limits sample with timestamp. */
type RlSample = {
  ts: number              // epoch ms for sorting
  iso: string             // original ISO string
  rl: Record<string, unknown>
}

/** Internal: one usage_limit_exceeded error event with the plan
 *  that was active when it fired. Plan attribution comes from the
 *  most recent token_count sample in the same rollout file
 *  preceding the error timestamp. */
type LimitHit = {
  ts: number
  planType: string | null
}

/** Per-hour-of-day breakdown for a single local-tz date. Drives the
 *  Today view's hourly Codex-plan chart: same byPlan / limit-hit
 *  story as the Dashboard's per-day chart, but bucketed into the
 *  24 hours so the user can see "I worked on Free until 14:00,
 *  switched to Plus at 15:00, hit a limit at 16:00".
 *
 *  Bucket key shape matches the rest of the time-series API:
 *  `YYYY-MM-DD HH:00` (hour aligned, local-tz). Hours with no
 *  Codex activity get a row with empty byPlan + secondaryPct=null,
 *  consistent with the bar+line semantics the chart already uses
 *  for empty buckets on the daily chart. */
export type CodexPlanHourlyRow = {
  bucket: string                       // YYYY-MM-DD HH:00
  primaryPct: number
  secondaryPct: number | null
  byPlan: Record<string, number>
  limitHitPlans: string[]
  limitHitCount: number
  creditsExhausted: boolean
  dayCount: number                     // 0 = empty hour, 1 = had at least one sample
}

/** Aggregate Codex rate_limits + limit-hit error events into 24
 *  hourly buckets for one local-tz day. Re-parses the JSONL files
 *  (no DB cache) because the per-day codex_plan_daily aggregate
 *  already collapsed the hour info; cheap on a single user's daily
 *  data (typically <1k rate_limits samples per day). */
export async function aggregateCodexPlanHourly(targetDay: string, codexDir?: string): Promise<CodexPlanHourlyRow[]> {
  const root = join(getCodexDir(codexDir), 'sessions')
  let years: string[] = []
  try { years = await readdir(root) } catch { return [] }
  // Per-hour-of-target-day collector. Key = HH (00..23), values
  // mirror the daily aggregator's structure.
  const byHour = new Map<string, RlSample[]>()
  const hitsByHour = new Map<string, LimitHit[]>()
  // Only walk directories that could contain events landing in the
  // target local day. Codex stores files by session-START UTC date,
  // but a session can run across local midnight, so we widen the
  // search to ±1 UTC day around the target.
  const target = new Date(`${targetDay}T00:00:00`)
  if (Number.isNaN(target.getTime())) return []
  const widenSet = new Set<string>()
  for (let dayOff = -1; dayOff <= 1; dayOff++) {
    const probe = new Date(target.getTime() + dayOff * 86_400_000)
    widenSet.add(`${probe.getUTCFullYear()}-${String(probe.getUTCMonth() + 1).padStart(2, '0')}-${String(probe.getUTCDate()).padStart(2, '0')}`)
  }

  for (const year of years) {
    if (!/^\d{4}$/.test(year)) continue
    const yearDir = join(root, year)
    const months = (await readdir(yearDir).catch(() => [] as string[]))
    for (const month of months) {
      if (!/^\d{2}$/.test(month)) continue
      const monthDir = join(yearDir, month)
      const days = (await readdir(monthDir).catch(() => [] as string[]))
      for (const day of days) {
        if (!/^\d{2}$/.test(day)) continue
        const utcDayKey = `${year}-${month}-${day}`
        if (!widenSet.has(utcDayKey)) continue
        const dayDir = join(monthDir, day)
        const files = (await readdir(dayDir).catch(() => [] as string[])).filter(
          f => f.startsWith('rollout-') && f.endsWith('.jsonl'),
        )
        for (const f of files) {
          const text = await readFile(join(dayDir, f), 'utf-8').catch(() => '')
          if (!text) continue
          let currentPlan: string | null = null
          for (const line of text.split('\n')) {
            if (!line.trim()) continue
            const hasRateLimits = line.includes('"rate_limits"')
            const hasUsageLimit = line.includes('usage_limit_exceeded')
            if (!hasRateLimits && !hasUsageLimit) continue
            let entry: Record<string, unknown>
            try { entry = JSON.parse(line) } catch { continue }
            const iso = typeof entry.timestamp === 'string' ? entry.timestamp : new Date().toISOString()
            const ts = Date.parse(iso)
            if (Number.isNaN(ts)) continue
            // Only events that land on the target local day.
            const evt = new Date(ts)
            const localDayKey = `${evt.getFullYear()}-${String(evt.getMonth() + 1).padStart(2, '0')}-${String(evt.getDate()).padStart(2, '0')}`
            if (localDayKey !== targetDay) continue
            const hourKey = String(evt.getHours()).padStart(2, '0')
            const payload = (entry as { payload?: Record<string, unknown> }).payload
            const rl = payload && (payload as { rate_limits?: Record<string, unknown> }).rate_limits
            if (rl && typeof rl === 'object') {
              const planType = (rl as { plan_type?: string }).plan_type
              if (typeof planType === 'string') currentPlan = planType
              const list = byHour.get(hourKey) ?? []
              list.push({ ts, iso, rl: rl as Record<string, unknown> })
              byHour.set(hourKey, list)
              continue
            }
            const errorInfo = payload && (payload as { codex_error_info?: string }).codex_error_info
            const errType = payload && (payload as { type?: string }).type
            if (errType === 'error' && errorInfo === 'usage_limit_exceeded') {
              const list = hitsByHour.get(hourKey) ?? []
              list.push({ ts, planType: currentPlan })
              hitsByHour.set(hourKey, list)
            }
          }
        }
      }
    }
  }

  // Emit 24 buckets — empty hours included so the bar chart's x-
  // axis stays aligned. Same shape as the per-day aggregate so the
  // /api/overview consumer can flatten both into the same response
  // type without per-shape branching.
  const out: CodexPlanHourlyRow[] = []
  for (let h = 0; h < 24; h++) {
    const hourKey = String(h).padStart(2, '0')
    const samples = byHour.get(hourKey) ?? []
    const hits = hitsByHour.get(hourKey) ?? []
    if (samples.length === 0 && hits.length === 0) {
      out.push({
        bucket: `${targetDay} ${hourKey}:00`,
        primaryPct: 0,
        secondaryPct: null,
        byPlan: {},
        limitHitPlans: [],
        limitHitCount: 0,
        creditsExhausted: false,
        dayCount: 0,
      })
      continue
    }
    samples.sort((a, b) => a.ts - b.ts)
    let peakPrimary = -1
    let peakSecondary = -1
    let exhausted = false
    const byPlan = new Map<string, number>()
    for (const s of samples) {
      const lid = s.rl.limit_id
      if (lid === 'codex') {
        const p = s.rl.primary as { used_percent?: number } | undefined
        const sec = s.rl.secondary as { used_percent?: number } | undefined
        const pt = (s.rl.plan_type as string | null) ?? 'unknown'
        if (p && typeof p.used_percent === 'number') {
          if (p.used_percent > peakPrimary) peakPrimary = p.used_percent
          const cur = byPlan.get(pt) ?? -1
          if (p.used_percent > cur) byPlan.set(pt, p.used_percent)
        }
        if (sec && typeof sec.used_percent === 'number' && sec.used_percent > peakSecondary) {
          peakSecondary = sec.used_percent
        }
      } else if (lid === 'premium') {
        const credits = (s.rl as { credits?: { has_credits?: boolean } }).credits
        if (credits && credits.has_credits === false) exhausted = true
      }
    }
    const limitPlans = Array.from(new Set(hits.map(h => h.planType ?? 'unknown')))
    out.push({
      bucket: `${targetDay} ${hourKey}:00`,
      primaryPct: peakPrimary >= 0 ? peakPrimary : 0,
      secondaryPct: peakSecondary >= 0 ? peakSecondary : (samples.length > 0 ? 0 : null),
      byPlan: Object.fromEntries(byPlan),
      limitHitPlans: limitPlans,
      limitHitCount: hits.length,
      creditsExhausted: exhausted,
      dayCount: 1,
    })
  }
  return out
}

/** Walk every Codex rollout file and produce a per-day SUMMARY snapshot
 *  that reflects what Codex CLI itself would have shown that day. Two
 *  things differ from a naïve "peak primary" approach:
 *
 *  1. Codex emits TWO independent limit families per session — `codex`
 *     (rolling 5h/7d windows) and `premium` (Plus/Pro credit pool, no
 *     windows). Naïvely picking the sample with max `primary.used_percent`
 *     ignores premium entirely (its primary is always null) and hides
 *     the case where the user has 50% in their 5h window but 0 credits
 *     left — which is when CLI says "limit reached".
 *
 *  2. `plan_type` can flip mid-day across `free` / `plus` / `pro`
 *     within the same rollout (multiple OpenAI auth tokens / session
 *     refreshes). Taking the LATEST sample's plan_type matches what
 *     CLI shows at end of day.
 *
 *  Composite rules:
 *    • primary  = peak (used_percent) across `limit_id=codex` samples,
 *                 with windowMinutes/resetsAt from the peak sample.
 *    • secondary = peak across `limit_id=codex` samples (independently
 *                  of primary peak — can come from a different sample).
 *    • credits  = latest by-time `credits` block from `limit_id=premium`
 *                 samples (current pool state at end of day).
 *    • planType, capturedAt = latest sample by time.
 *    • limitId  = 'premium' if any premium samples seen (binding
 *                 constraint), else 'codex'. UI uses this to decide
 *                 which signal to highlight.
 *    • rateLimitReachedType = first non-null observed (rare; Codex
 *                             rarely populates this).
 *
 *  Cheap full rebuild on every ingest: rate_limits payloads are tiny,
 *  even a heavy user has <100 rollouts/day with a few hundred samples
 *  each. Incrementalize via mtime later if it shows up in profiles. */
export async function aggregateCodexPlanDaily(codexDir?: string): Promise<CodexPlanDailyRow[]> {
  const root = join(getCodexDir(codexDir), 'sessions')
  let years: string[] = []
  try { years = await readdir(root) } catch { return [] }
  // Collect raw samples per day first; summarize after.
  const byDay = new Map<string, RlSample[]>()
  // Limit-hit error events per local day. Authoritative source for
  // "the user actually got 429'd" — see CodexPlanDailyRow.limitHits.
  const hitsByDay = new Map<string, LimitHit[]>()
  for (const year of years) {
    if (!/^\d{4}$/.test(year)) continue
    const yearDir = join(root, year)
    const months = (await readdir(yearDir).catch(() => [] as string[]))
    for (const month of months) {
      if (!/^\d{2}$/.test(month)) continue
      const monthDir = join(yearDir, month)
      const days = (await readdir(monthDir).catch(() => [] as string[]))
      for (const day of days) {
        if (!/^\d{2}$/.test(day)) continue
        const dayKey = `${year}-${month}-${day}`
        const dayDir = join(monthDir, day)
        const files = (await readdir(dayDir).catch(() => [] as string[])).filter(
          f => f.startsWith('rollout-') && f.endsWith('.jsonl'),
        )
        for (const f of files) {
          const text = await readFile(join(dayDir, f), 'utf-8').catch(() => '')
          if (!text) continue
          // We walk the file once and collect TWO kinds of records:
          //   1. rate_limits samples (lines containing `"rate_limits"`)
          //   2. usage_limit_exceeded error events
          // Plan attribution for an error event = plan_type from
          // the most recent rate_limits sample in this file that
          // preceded the error. Tracked in `currentPlan` as we
          // walk in chronological order.
          let currentPlan: string | null = null
          for (const line of text.split('\n')) {
            if (!line.trim()) continue
            const hasRateLimits = line.includes('"rate_limits"')
            const hasUsageLimit = line.includes('usage_limit_exceeded')
            if (!hasRateLimits && !hasUsageLimit) continue
            let entry: Record<string, unknown>
            try { entry = JSON.parse(line) } catch { continue }
            const iso = typeof entry.timestamp === 'string' ? entry.timestamp : new Date().toISOString()
            const ts = Date.parse(iso)
            if (Number.isNaN(ts)) continue
            // Bucket by the event's OWN timestamp (in server-local
            // tz), not by the session-dir's path date. Codex names
            // each session dir by the start UTC date, so a session
            // that runs from 22:00 to 03:00 across local midnight
            // dumps everything into the start-day bucket — making
            // "today's" data invisible until the user starts a new
            // session. Translating each sample to its own local-tz
            // date fixes that.
            const eventDate = new Date(ts)
            const eventDayKey = `${eventDate.getFullYear()}-`
              + `${String(eventDate.getMonth() + 1).padStart(2, '0')}-`
              + `${String(eventDate.getDate()).padStart(2, '0')}`

            const payload = (entry as { payload?: Record<string, unknown> }).payload
            // (1) rate_limits sample
            const rl = payload && (payload as { rate_limits?: Record<string, unknown> }).rate_limits
            if (rl && typeof rl === 'object') {
              const planType = (rl as { plan_type?: string }).plan_type
              if (typeof planType === 'string') currentPlan = planType
              const list = byDay.get(eventDayKey) ?? []
              list.push({ ts, iso, rl: rl as Record<string, unknown> })
              byDay.set(eventDayKey, list)
              continue
            }
            // (2) usage_limit_exceeded error event. Authoritative
            // "user got 429'd" signal — the rate_limits-only path
            // misses the actual block moment because Codex doesn't
            // ship a token_count event for failed requests.
            const errorInfo = payload && (payload as { codex_error_info?: string }).codex_error_info
            const errType = payload && (payload as { type?: string }).type
            if (errType === 'error' && errorInfo === 'usage_limit_exceeded') {
              const list = hitsByDay.get(eventDayKey) ?? []
              list.push({ ts, planType: currentPlan })
              hitsByDay.set(eventDayKey, list)
            }
          }
        }
      }
    }
  }

  const out: CodexPlanDailyRow[] = []
  for (const [day, samples] of byDay) {
    samples.sort((a, b) => a.ts - b.ts)
    const latest = samples[samples.length - 1]

    let peakPrimary = -1
    let peakPrimarySample: RlSample | null = null
    let peakSecondary = -1
    let peakSecondarySample: RlSample | null = null
    let lastPremium: RlSample | null = null
    let reachedType: string | null = null
    let sawPremium = false
    // Per-plan peak primary %. Distinct from `peakPrimary` (the
    // overall day peak): when the user worked across plans (e.g.
    // free in the morning, plus in the afternoon) we keep both
    // values so the bar chart can render each plan as its own
    // colored stacked segment.
    const byPlan = new Map<string, number>()

    for (const s of samples) {
      const lid = s.rl.limit_id
      const rt = (s.rl.rate_limit_reached_type as string | null) ?? null
      if (rt && !reachedType) reachedType = rt

      if (lid === 'codex') {
        const p = s.rl.primary as { used_percent?: number } | undefined
        const sec = s.rl.secondary as { used_percent?: number } | undefined
        const planType = (s.rl.plan_type as string | null) ?? 'unknown'
        if (p && typeof p.used_percent === 'number') {
          if (p.used_percent > peakPrimary) {
            peakPrimary = p.used_percent
            peakPrimarySample = s
          }
          const cur = byPlan.get(planType) ?? -1
          if (p.used_percent > cur) byPlan.set(planType, p.used_percent)
        }
        if (sec && typeof sec.used_percent === 'number' && sec.used_percent > peakSecondary) {
          peakSecondary = sec.used_percent
          peakSecondarySample = s
        }
      } else if (lid === 'premium') {
        sawPremium = true
        // Latest premium sample wins — credits change over the day,
        // we want the final state.
        lastPremium = s
      }
    }

    const snapshot: CodexPlanSnapshot = {
      planType: (latest.rl.plan_type as string | null) ?? null,
      limitId: sawPremium ? 'premium' : 'codex',
      limitName: (latest.rl.limit_name as string | null) ?? null,
      primary: peakPrimarySample
        ? toWindow(peakPrimarySample.rl.primary as Record<string, unknown>)
        : null,
      secondary: peakSecondarySample
        ? toWindow(peakSecondarySample.rl.secondary as Record<string, unknown>)
        : null,
      credits: lastPremium ? toCredits(lastPremium.rl.credits) : null,
      rateLimitReachedType: reachedType,
      capturedAt: latest.iso,
    }

    // Limit hits attributed to plans. Unique plan list goes in
    // limitHitPlans (drives the red-stripe badge in the chart);
    // total count surfaces in the tooltip for "I hit limit N times
    // today" sanity. Hits with null planType (an error fired
    // before any token_count got a plan label) get bucketed under
    // 'unknown' so the count stays accurate.
    const dayHits = hitsByDay.get(day) ?? []
    const limitHitPlans = Array.from(new Set(dayHits.map(h => h.planType ?? 'unknown')))

    out.push({
      day,
      primaryPct: peakPrimary >= 0 ? peakPrimary : 0,
      secondaryPct: peakSecondary >= 0 ? peakSecondary : 0,
      byPlan: Object.fromEntries(byPlan),
      limitHitPlans,
      limitHitCount: dayHits.length,
      snapshot,
    })
  }
  return out.sort((a, b) => a.day.localeCompare(b.day))
}
