/**
 * KPI: Agent efficiency — two complementary shares that together
 * tell a small story:
 *   - "Cost share": what % of the project's spend ran inside
 *     subagents.
 *   - "Tokens share": what % of the project's token volume ran
 *     inside subagents.
 *
 * Now uses agentTelemetry.totals which is registry-UNFILTERED —
 * the percentages reflect ALL subagent activity, not only roles
 * the user has classified. A user with an empty registry still
 * sees the truth here.
 *
 * When the two % differ materially, you learn something: if cost
 * share > tokens share, your agents skew toward premium models (or
 * eat proportionally more dollars per token). If cost share < tokens
 * share, agents produce more tokens per dollar (cheaper mix / better
 * cache hits). Same-ish = agents are a neutral slice of the work.
 */

import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { OverviewResponse } from '../../types'
import { KpiGroup, KpiMetric } from '../../components/widgets-misc'

function sharePct(num: number, denom: number): string {
  if (denom <= 0) return '—'
  const pct = (num / denom) * 100
  return pct >= 10 ? `${pct.toFixed(0)}%` : `${pct.toFixed(1)}%`
}

export function kpiAgentDelegationWidget(t: T, data: OverviewResponse): WidgetDef {
  const agentCost = data.agentTelemetry.totals.cost
  const totalCost = data.totals.cost

  const agentTokens = data.agentTelemetry.totals.totalTokens
  // Main project tokens are split across fields in the totals block —
  // include all four kinds so the denominator is "all tokens the
  // project moved", matching the agent-side totalTokens definition.
  // cacheWrite is null on Codex-only scopes (OpenAI doesn't report
  // a separate cache-write count). Treat null as 0 for the
  // "tokens spent at all" denominator — better than blowing up
  // the whole KPI when some calls in scope come from Codex.
  const projectTokens =
    data.totals.inputTokens +
    data.totals.outputTokens +
    data.totals.cacheRead +
    (data.totals.cacheWrite ?? 0)

  return {
    id: 'kpi-agent-delegation',
    title: t('agents.kpi.efficiency.title'),
    description: t('agents.kpi.efficiency.desc'),
    category: 'kpi',
    section: 'agents',
    sizes: [{ w: 1, h: 1 }, { w: 2, h: 1 }],
    minW: 1,
    minH: 1,
    render: () => (
      <KpiGroup title={t('agents.kpi.efficiency.title')}>
        <KpiMetric label={t('agents.kpi.efficiency.costShare')} value={sharePct(agentCost, totalCost)} />
        <KpiMetric label={t('agents.kpi.efficiency.tokensShare')} value={sharePct(agentTokens, projectTokens)} />
      </KpiGroup>
    ),
  }
}
