import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { OverviewResponse } from '../../types'
import { KpiGroup, KpiMetric } from '../../components/widgets-misc'
import { fmtTokens } from '../../lib/format'

export function kpiTokensWidget(t: T, data: OverviewResponse): WidgetDef {
  return {
    id: 'kpi-tokens',
    title: t('kpi.tokens'),
    description: t('widgets.kpi-tokens.description'),
    category: 'kpi',
    sizes: [{ w: 1, h: 1 }, { w: 2, h: 1 }],
    minW: 1,
    minH: 1,
    render: () => (
      <KpiGroup title={t('kpi.tokens')}>
        <KpiMetric label={t('kpi.input')} value={fmtTokens(data.totals.inputTokens)} />
        <KpiMetric label={t('kpi.output')} value={fmtTokens(data.totals.outputTokens)} />
      </KpiGroup>
    ),
  }
}
