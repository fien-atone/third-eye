/**
 * KPI: Agent sessions — how many agent spawns ran in range, plus
 * the token volume they moved. Two-metric pin matching the shape of
 * kpi-spend / kpi-tokens / kpi-cache (Total + secondary) so it fits
 * the standard h=1 KPI row.
 */

import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { OverviewResponse } from '../../types'
import { KpiGroup, KpiMetric } from '../../components/widgets-misc'
import { fmtInt, fmtTokens } from '../../lib/format'

export function kpiAgentSessionsWidget(t: T, data: OverviewResponse): WidgetDef {
  const { totals } = data.agentTelemetry
  return {
    id: 'kpi-agent-sessions',
    title: t('agents.kpi.sessions.title'),
    description: t('agents.kpi.sessions.desc'),
    category: 'kpi',
    section: 'agents',
    sizes: [{ w: 1, h: 1 }, { w: 2, h: 1 }],
    minW: 1,
    minH: 1,
    render: () => (
      <KpiGroup title={t('agents.kpi.sessions.title')}>
        <KpiMetric label={t('agents.kpi.sessions.total')} value={fmtInt(totals.sessions)} />
        <KpiMetric label={t('agents.kpi.sessions.tokens')} value={fmtTokens(totals.totalTokens)} />
      </KpiGroup>
    ),
  }
}
