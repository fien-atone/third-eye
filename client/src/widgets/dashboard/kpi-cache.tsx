import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { OverviewResponse } from '../../types'
import { KpiGroup, KpiMetric } from '../../components/widgets-misc'
import { fmtTokens } from '../../lib/format'

export function kpiCacheWidget(t: T, data: OverviewResponse): WidgetDef {
  return {
    id: 'kpi-cache',
    title: t('kpi.cache'),
    description: t('widgets.kpi-cache.description'),
    category: 'kpi',
    sizes: [{ w: 1, h: 1 }, { w: 2, h: 1 }],
    minW: 1,
    minH: 1,
    render: () => (
      <KpiGroup title={t('kpi.cache')}>
        <KpiMetric label={t('kpi.read')} value={fmtTokens(data.totals.cacheRead)} />
        <KpiMetric label={t('kpi.write')} value={fmtTokens(data.totals.cacheWrite)} />
      </KpiGroup>
    ),
  }
}
