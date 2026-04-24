/**
 * KPI: Agent session average — how much a typical agent spawn costs,
 * and how big (in tokens) it is. Two metrics answer the same question
 * ("how expensive is a session?") in two currencies users actually
 * compare against: dollars, and tokens. The pin title already scopes
 * it to agent sessions so the metric labels can be short.
 *
 * NB: The internal id keeps the old `kpi-agent-tokens-per-session`
 * name so saved layouts don't have to migrate.
 */

import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { OverviewResponse } from '../../types'
import { KpiGroup, KpiMetric } from '../../components/widgets-misc'
import { fmtCurrency, fmtTokens } from '../../lib/format'

export function kpiAgentTokensPerSessionWidget(t: T, data: OverviewResponse): WidgetDef {
  const { totals } = data.agentTelemetry
  const avgCost = totals.sessions > 0 ? totals.cost / totals.sessions : 0
  const avgTokens = totals.sessions > 0 ? totals.totalTokens / totals.sessions : 0
  return {
    id: 'kpi-agent-tokens-per-session',
    title: t('agents.kpi.sessionAvg.title'),
    description: t('agents.kpi.sessionAvg.desc'),
    category: 'kpi',
    section: 'agents',
    sizes: [{ w: 1, h: 1 }, { w: 2, h: 1 }],
    minW: 1,
    minH: 1,
    render: () => (
      <KpiGroup title={t('agents.kpi.sessionAvg.title')}>
        <KpiMetric label={t('agents.kpi.sessionAvg.cost')} value={fmtCurrency(avgCost)} />
        <KpiMetric label={t('agents.kpi.sessionAvg.tokens')} value={fmtTokens(avgTokens)} />
      </KpiGroup>
    ),
  }
}
