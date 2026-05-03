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
export type SettingsResponse = {
  updates: UpdatesSettings
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
  /** Codex / ChatGPT plan-usage snapshot. Present only when the
   *  current scope contains Codex calls. Fields mirror the
   *  CodexPlanSnapshot shape in server/lib/providers/codex.ts. */
  codexPlan?: {
    planType: string | null
    limitId: string | null
    limitName: string | null
    primary: { usedPercent: number; windowMinutes: number; resetsAt: number } | null
    secondary: { usedPercent: number; windowMinutes: number; resetsAt: number } | null
    credits: number | null
    rateLimitReachedType: string | null
    capturedAt: string
  } | null
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
