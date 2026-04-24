/** Central registry for dashboard & insights widget catalogs. Each
 *  widget lives in its own file under ./dashboard/ or ./insights/; this
 *  file just wires them together. */

import type { Locale } from 'date-fns'
import type { T } from '../i18n'
import type { Granularity, InsightsResponse, OverviewResponse } from '../types'
import type { WidgetDef } from './grid'

import { kpiSpendWidget } from './dashboard/kpi-spend'
import { kpiTokensWidget } from './dashboard/kpi-tokens'
import { kpiCacheWidget } from './dashboard/kpi-cache'
import { kpiScopeWidget } from './dashboard/kpi-scope'
import { costByProjectWidget } from './dashboard/cost-by-project'
import { costByModelWidget } from './dashboard/cost-by-model'
import { tokensWidget } from './dashboard/tokens'
import { callsWidget } from './dashboard/calls'
import { modelsWidget } from './dashboard/models'
import { activityWidget } from './dashboard/activity'
import { topProjectsWidget } from './dashboard/top-projects'
import { hourTimelineWidget } from './dashboard/hour-timeline'
import { kpiAgentSessionsWidget } from './dashboard/kpi-agent-sessions'
import { kpiAgentTokensPerSessionWidget } from './dashboard/kpi-agent-tokens-per-session'
import { kpiAgentDelegationWidget } from './dashboard/kpi-agent-delegation'
import { agentDistributionWidget } from './dashboard/agent-distribution'
import { agentTopSessionsWidget } from './dashboard/agent-top-sessions'
import { agentTimelineWidget } from './dashboard/agent-timeline'

import { subagentsWidget } from './insights/subagents'
import { skillsWidget } from './insights/skills'
import { mcpWidget } from './insights/mcp'
import { bashWidget } from './insights/bash'
import { filesWidget } from './insights/files'
import { flagsWidget } from './insights/flags'
import { versionsWidget } from './insights/versions'
import { branchesWidget } from './insights/branches'

export type DashboardCtx = {
  t: T
  data: OverviewResponse
  modelNames: string[]
  granularity: Granularity
  onSelectProject: (p: string) => void
  inProjectView: boolean
  series: Array<Record<string, number | string>>
  hasAnyData: boolean
  hasTokenData: boolean
  activeBuckets: number
  avgPerBucket: number
}

export function buildDashboardCatalog(ctx: DashboardCtx): WidgetDef[] {
  const { t, data, modelNames, granularity, onSelectProject, inProjectView, series,
    hasAnyData, hasTokenData, activeBuckets, avgPerBucket } = ctx
  // Widgets shared between the Dashboard and the Project view.
  const shared: WidgetDef[] = [
    kpiSpendWidget(t, data, granularity, avgPerBucket),
    kpiTokensWidget(t, data),
    kpiCacheWidget(t, data),
    kpiScopeWidget(t, data, granularity, inProjectView, activeBuckets),
    costByModelWidget(t, series, granularity, hasAnyData, modelNames),
    tokensWidget(t, series, granularity, hasTokenData),
    callsWidget(t, series, granularity, hasAnyData),
    modelsWidget(t, data),
    activityWidget(t, data),
  ]
  // Project-only widgets — Agent insights are scoped to a single
  // project (registry is per-project). Surfacing them on the main
  // dashboard would show cross-project aggregates that can't be
  // configured there, so gate on inProjectView.
  if (inProjectView) {
    return [
      ...shared,
      kpiAgentSessionsWidget(t, data),
      kpiAgentTokensPerSessionWidget(t, data),
      kpiAgentDelegationWidget(t, data),
      agentDistributionWidget(t, data),
      agentTopSessionsWidget(t, data),
      agentTimelineWidget(t, data, series, granularity),
    ]
  }
  // Dashboard-only widgets: "cost by project" and "top projects" aggregate
  // ACROSS projects — showing them inside a single project's view makes no
  // semantic sense (cost-by-project would collapse to a single bar;
  // top-projects to a single row). Gate on !inProjectView so they're
  // unavailable in the project picker, and reconcile() scrubs them if a
  // stale saved layout still references them.
  // Hour-timeline only meaningful when the series IS hourly — adding it
  // unconditionally would put a 24-bar chart on the daily dashboard
  // where the data is one bar per day. Gate on granularity.
  const cross: WidgetDef[] = [
    costByProjectWidget(t, data, series, granularity, hasAnyData, onSelectProject),
    topProjectsWidget(t, data),
  ]
  if (granularity === 'hour') {
    cross.unshift(hourTimelineWidget(t, series, hasAnyData))
  }
  return [...shared, ...cross]
}

export type InsightsCtx = {
  t: T
  data: InsightsResponse
  projectKey: string | null
  dl: Locale
}

export function buildInsightsCatalog(ctx: InsightsCtx): WidgetDef[] {
  const { t, data, projectKey } = ctx
  return [
    subagentsWidget(t, data),
    skillsWidget(t, data),
    mcpWidget(t, data),
    bashWidget(t, data),
    filesWidget(t, data, projectKey),
    flagsWidget(t, data),
    versionsWidget(t, data),
    branchesWidget(t, data),
  ]
}
