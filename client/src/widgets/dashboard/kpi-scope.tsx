import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { Granularity, OverviewResponse } from '../../types'
import { KpiGroup, KpiMetric } from '../../components/widgets-misc'

export function kpiScopeWidget(t: T, data: OverviewResponse, granularity: Granularity, inProjectView: boolean, activeBuckets: number): WidgetDef {
  return {
    id: 'kpi-scope',
    title: t('kpi.scope'),
    description: t('widgets.kpi-scope.description'),
    category: 'kpi',
    sizes: [{ w: 1, h: 1 }, { w: 2, h: 1 }],
    minW: 1,
    minH: 1,
    render: () => (
      <KpiGroup title={t('kpi.scope')}>
        {!inProjectView && <KpiMetric label={t('kpi.projects')} value={String(data.totals.projects)} />}
        <KpiMetric label={`${t('kpi.active')} ${t(granularity === 'day' ? 'summary.days' : granularity === 'week' ? 'summary.weeks' : 'summary.months')}`} value={`${activeBuckets} / ${data.frame.bucketCount}`} />
      </KpiGroup>
    ),
  }
}
