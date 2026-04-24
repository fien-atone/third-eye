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
  subagents: InsightsItem[]
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
    cacheWrite: number
    projects: number
  }
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
}

/** Recharts tooltip props (re-typed loosely — Recharts types are
 *  generic and inconvenient to import). */
export type TTProps = { active?: boolean; payload?: any[]; label?: string }
