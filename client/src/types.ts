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
  /** True while a GitHub poll is currently in flight — used to render
   *  a "checking…" spinner next to the version badge. */
  checking: boolean
  /** ISO timestamp of the last poll attempt (success OR failure). null
   *  before the first poll. Tooltip text on the up-to-date checkmark. */
  lastCheckedAt: string | null
  /** ISO timestamp of the next scheduled server-side poll. Lets the
   *  client wake up just before, so the 1.2 s "checking" flicker is
   *  caught reliably without polling /api/version constantly. */
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
  subagents: InsightsItem[]
  skills: InsightsItem[]
  mcp: InsightsItem[]
  bash: InsightsItem[]
  files: InsightsItem[]
  filesUnique: number
  flags: { plan_mode_calls: number; todo_write_calls: number; total_calls: number }
  branches: Array<{ name: string; calls: number; cost: number }>
  versions: VersionRow[]
  heatmap: Array<{ dow: number; hour: number; calls: number; cost: number }>
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
  lastIngestAt: string | null
}

/** Recharts tooltip props (re-typed loosely — Recharts types are
 *  generic and inconvenient to import). */
export type TTProps = { active?: boolean; payload?: any[]; label?: string }
