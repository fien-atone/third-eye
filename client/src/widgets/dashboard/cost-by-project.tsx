import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { Granularity, OverviewResponse } from '../../types'
import { CostByProjectPanel } from '../panels'

export function costByProjectWidget(
  t: T,
  data: OverviewResponse,
  series: Array<Record<string, number | string>>,
  granularity: Granularity,
  hasAnyData: boolean,
  onSelectProject: (p: string) => void,
): WidgetDef {
  return {
    id: 'cost-by-project',
    title: t('panel.costByProject.title'),
    description: t('widgets.cost-by-project.description'),
    category: 'chart',
    sizes: [{ w: 4, h: 3 }, { w: 4, h: 2 }, { w: 2, h: 3 }, { w: 2, h: 2 }],
    minW: 2,
    minH: 2,
    render: ({ h }) => (
      <CostByProjectPanel
        series={series}
        topProjects={data.topProjects ?? []}
        otherProjects={data.otherProjects ?? { count: 0, cost: 0 }}
        granularity={granularity}
        hasData={hasAnyData}
        onSelectProject={onSelectProject}
        showLegend={h >= 3}
      />
    ),
  }
}
