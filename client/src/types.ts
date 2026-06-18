/** Shared types used across screens, widgets, panels. */

export type Granularity = 'hour' | 'day' | 'week' | 'month'

export type Provider = {
  id: string
  label: string
  calls: number
  cost: number
  firstTs: string
  lastTs: string
}
export type ProvidersResponse = { providers: Provider[]; lastIngestAt: string | null }

/** Server reports only what it learned from GitHub. The "current"
 *  version (and therefore the outdated check) is computed on the client
 *  from __APP_VERSION__ — see lib/semver.ts and AppHeader. */
export type VersionResponse = {
  latest: string | null
  latestUrl: string | null
  latestName: string | null
  latestPublishedAt: string | null
  /** True while the client is in the middle of fetching /api/version
   *  (plus a min-visible buffer). Synthesized client-side by
   *  lib/version-poll.ts — the server does NOT include this field.
   *  Drives the header spinner. */
  checking: boolean
  /** ISO timestamp of the last poll attempt (success OR failure). null
   *  before the first poll. Tooltip text on the up-to-date checkmark. */
  lastCheckedAt: string | null
  /** ISO timestamp of the next scheduled server-side poll. The client
   *  uses it to schedule its own refetch precisely, instead of
   *  polling at a fixed cadence — one /api/version per cycle. */
  nextCheckAt: string | null
}

export type UpdatesSettings = {
  enabled: boolean
  intervalSeconds: number
}
/** Auto-ingest scheduler settings. When enabled, the server runs an
 *  incremental ingest every `intervalSeconds` and the manual Refresh
 *  button becomes a "do it now" rather than the only update path. */
export type IngestSettings = {
  enabled: boolean
  intervalSeconds: number
}
export type SettingsResponse = {
  updates: UpdatesSettings
  ingest: IngestSettings
  /** Configured Claude source roots, computed live from env on
   *  every read. NOT persisted — env is the source of truth, and a
   *  re-launch picks up env changes. Surfaced via /api/settings so
   *  the client can render the Settings → Sources panel and let
   *  users see which Claude roots are being read. */
  sources: { claude: Array<{ path: string; alias: string }> }
  /** 'dev' unlocks sub-hour polling presets in the settings UI for
   *  testing. Production builds always get 'prod' regardless of what
   *  the client sends — the floor is enforced server-side too. */
  mode: 'dev' | 'prod'
}

export type ProjectInfo = {
  id: string
  key: string
  label: string         // effective label (custom if set, otherwise auto)
  autoLabel: string     // original auto-derived label
  customLabel: string | null
  favorite: boolean
  calls: number
  cost: number
  firstTs: string
  lastTs: string
  /** Source alias that contributed to this project (when a ?source=
   *  filter is active, this is the alias the filter matched; when
   *  no filter is set, the first alias that contributed — useful as
   *  a hint that multi-source projects exist). */
  sourceAlias?: string
}
export type ProjectsResponse = { projects: ProjectInfo[] }

export type InsightsItem = { name: string; count: number; cost: number }
export type VersionRow = {
  name: string
  calls: number
  cost: number
  tokens: number
  first_ts: string
  last_ts: string
}

export type InsightsResponse = {
  project: { key: string }
  range: { start: string; end: string }
  skills: InsightsItem[]
  mcp: InsightsItem[]
  bash: InsightsItem[]
  files: InsightsItem[]
  filesUnique: number
  flags: { plan_mode_calls: number; todo_write_calls: number; total_calls: number }
  branches: Array<{ name: string; calls: number; cost: number }>
  versions: VersionRow[]
}

export type OverviewResponse = {
  frame: {
    start: string
    end: string
    granularity: Granularity
    bucketCount: number
    providers: string[]
    project: { id: string | null; key: string; label: string } | null
  }
  totals: {
    cost: number
    calls: number
    inputTokens: number
    outputTokens: number
    cacheRead: number
    /** null when the scope's data sources don't report cache write
     *  (Codex's prompt caching is implicit — writes are folded into
     *  input_tokens at no extra cost, no separate field). UI must
     *  distinguish this from a true zero (rare but possible: a
     *  Claude session with all-uncached prompts). */
    cacheWrite: number | null
    projects: number
  }
  /** Codex / ChatGPT plan-usage snapshot for the day in scope. Present
   *  only when the request is single-day AND that day has Codex calls.
   *  Fields mirror CodexPlanSnapshot in server/lib/providers/codex.ts.
   *
   *  primary/secondary represent the day's PEAK window utilization
   *  (worst case the user hit). `credits` carries the day's LATEST
   *  premium-credits state — for paid plans this is the binding
   *  signal CLI uses to say "limit reached" (independent of windows).
   *  `limitId='premium'` flags that premium samples were seen on the
   *  day, telling the widget to surface credits prominently. */
  codexPlan?: {
    planType: string | null
    limitId: string | null
    limitName: string | null
    primary: { usedPercent: number; windowMinutes: number; resetsAt: number } | null
    secondary: { usedPercent: number; windowMinutes: number; resetsAt: number } | null
    credits: { hasCredits: boolean | null; unlimited: boolean | null; balance: string | null } | null
    rateLimitReachedType: string | null
    capturedAt: string
  } | null
  /** Codex plan history — per-day rows for multi-day ranges, drives
   *  the Dashboard's plan-trajectory line chart. Inverse of `codexPlan`
   *  above: present on multi-day, null on single-day. */
  codexPlanHistory?: Array<{
    /** Bucket key in dashboard granularity. day: 'YYYY-MM-DD',
     *  week: 'YYYY-MM-DD' (week start), month: 'YYYY-MM'. */
    bucket: string
    /** Peak 5h-window utilization within the bucket (max of daily peaks). */
    primaryPct: number
    /** Peak 7d-window % within the bucket (max of daily peaks), or null
     *  when no Codex day fell inside this bucket — the overlay line
     *  breaks across these gaps so we don't fake a "0%" reading. */
    secondaryPct: number | null
    /** Per-plan_type peak 5h-window % aggregated across all days in
     *  the bucket. The bar chart renders one colored stacked segment
     *  per entry. Empty on buckets with no Codex usage. */
    byPlan: Record<string, number>
    /** Plans that hit a `usage_limit_exceeded` error during the
     *  bucket — authoritative "got 429'd" signal sourced directly
     *  from Codex's error events. Drives the red marker on grouped
     *  bars whose plan actually got blocked (per-plan peaks alone
     *  understate this since Codex doesn't emit a token_count for
     *  the failed request). */
    limitHitPlans: string[]
    /** Total count of usage_limit_exceeded events in the bucket
     *  (across plans). Surfaced in the tooltip. */
    limitHitCount: number
    /** True if any day in the bucket had credits.hasCredits === false. */
    creditsExhausted: boolean
    /** Number of Codex-active days inside the bucket. 0 = empty bucket. */
    dayCount: number
  }> | null
  series: Array<Record<string, number | string>>
  models: Array<{
    name: string
    cost: number
    calls: number
    inputTokens: number
    outputTokens: number
    cacheRead: number
    cacheWrite: number
  }>
  categories: Array<{ name: string; cost: number; calls: number }>
  projects: Array<{
    name: string
    label: string
    id: string | null
    favorite: boolean
    cost: number
    calls: number
  }>
  topProjects: Array<{ key: string; id: string | null; label: string; cost: number; calls: number }>
  otherProjects: { count: number; cost: number }
  agentTelemetry: AgentTelemetry
  lastIngestAt: string | null
}

export type AgentTelemetry = {
  totals: {
    sessions: number
    inputTokens: number
    cacheCreate: number
    cacheRead: number
    outputTokens: number
    totalTokens: number
    cost: number
    toolUses: number
    durationS: number
  }
  byRole: Array<{
    role: string                 // effective label: display_name OR raw role
    sessions: number
    tokens: number
    cost: number
    toolUses: number
  }>
  topSessions: Array<{
    agentId: string
    source: string               // 'subagent' | 'task'
    role: string                 // effective label (see byRole.role)
    rawRole: string              // original detected role, for reference
    confidence: string
    description: string
    tsStart: string
    durationS: number
    totalTokens: number
    cost: number
    toolUses: number
    apiCalls: number
  }>
  timeline: {
    roles: string[]              // all effective roles seen in range, sorted
    series: Array<Record<string, number | string>>  // per-bucket row, keys: bucket, `agent:<role>`
  }
  /** Tool-usage breakdown per role. UI renders as a matrix: rows are
   *  roles, columns are top-N most-used tools globally, cells are
   *  counts (with % computed client-side as cell / role.toolUses). */
  toolSpectrum: {
    topTools: string[]   // global top-N tool names, ordered by total usage
    roles: Array<{
      role: string       // effective label
      sessions: number
      toolUses: number   // total tool calls across this role's sessions
      tools: Record<string, number>  // tool -> count for this role
    }>
  }
  /** Spawn batches — agents sharing one promptId were dispatched
   *  in a single parallel orchestration call by Claude. */
  spawnBatches: {
    avgSize: number       // mean across all batches (singletons excluded)
    maxSize: number       // largest fan-out seen
    batchedAgents: number // total sessions that ran inside a batch
    batchCount: number    // distinct batch count
    batches: Array<{
      promptId: string
      size: number
      spawnedAt: string   // ISO of earliest agent in this batch
      cost: number
      tokens: number
      roles: Array<{ role: string; sessions: number }>  // role mix in this batch
    }>
  }
}

/** Recharts tooltip props (re-typed loosely — Recharts types are
 *  generic and inconvenient to import). */
export type TTProps = { active?: boolean; payload?: any[]; label?: string }
