/**
 * KPI: Sidechain ratio — what fraction of AI spend ran inside
 * subagents (regardless of whether the user has classified those
 * roles in the agent registry). Answers "how much of my work am
 * I delegating?".
 *
 * Distinct from kpi-agent-delegation, which only counts roles the
 * user has explicitly classified. This one uses the unfiltered
 * agentTelemetry.delegation totals so a user with an empty registry
 * still sees the real picture.
 *
 * Two metrics:
 *   - "Spend in subagents": cost ratio.
 *   - "Sessions": absolute count of subagent sessions in range.
 */

import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { OverviewResponse } from '../../types'
import { KpiGroup, KpiMetric } from '../../components/widgets-misc'
import { fmtInt } from '../../lib/format'

function sharePct(num: number, denom: number): string {
  if (denom <= 0) return '—'
  const pct = (num / denom) * 100
  return pct >= 10 ? `${pct.toFixed(0)}%` : `${pct.toFixed(1)}%`
}

export function kpiAgentSidechainWidget(t: T, data: OverviewResponse): WidgetDef {
  const subagentCost = data.agentTelemetry.delegation.cost
  const subagentSessions = data.agentTelemetry.delegation.sessions
  const totalCost = data.totals.cost

  return {
    id: 'kpi-agent-sidechain',
    title: t('agents.kpi.sidechain.title'),
    description: t('agents.kpi.sidechain.desc'),
    category: 'kpi',
    section: 'agents',
    sizes: [{ w: 1, h: 1 }, { w: 2, h: 1 }],
    minW: 1,
    minH: 1,
    render: () => (
      <KpiGroup title={t('agents.kpi.sidechain.title')}>
        <KpiMetric
          label={t('agents.kpi.sidechain.costShare')}
          value={sharePct(subagentCost, totalCost)}
        />
        <KpiMetric
          label={t('agents.kpi.sidechain.sessions')}
          value={fmtInt(subagentSessions)}
        />
      </KpiGroup>
    ),
  }
}
