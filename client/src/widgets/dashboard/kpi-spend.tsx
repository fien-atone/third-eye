import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { Granularity, OverviewResponse } from '../../types'
import { KpiGroup, KpiMetric } from '../../components/widgets-misc'
import { fmtCurrency } from '../../lib/format'

export function kpiSpendWidget(t: T, data: OverviewResponse, granularity: Granularity, avgPerBucket: number): WidgetDef {
  return {
    id: 'kpi-spend',
    title: t('kpi.spend'),
    description: t('widgets.kpi-spend.description'),
    category: 'kpi',
    sizes: [{ w: 1, h: 1 }, { w: 2, h: 1 }],
    minW: 1,
    minH: 1,
    // Two columns, label+value only — same shape as kpi-tokens / kpi-cache
    // so this widget fits the standard h=1 row height (132px). The API-calls
    // subvalue lives in the dedicated `calls` widget.
    render: () => (
      <KpiGroup title={t('kpi.spend')}>
        <KpiMetric label={t('kpi.total')} value={fmtCurrency(data.totals.cost)} />
        <KpiMetric label={`${t('kpi.avg')} / ${t('controls.' + granularity as any)}`} value={fmtCurrency(avgPerBucket)} />
      </KpiGroup>
    ),
  }
}
