import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { Granularity } from '../../types'
import { ChartEmpty, PanelHeader } from '../../components/widgets-misc'
import { COLORS } from '../../lib/format'
import { SeriesTooltip } from '../tooltips'
import { TIMESERIES_MARGIN, TIMESERIES_YAXIS_WIDTH } from '../panels'

export function costByModelWidget(
  t: T,
  series: Array<Record<string, number | string>>,
  granularity: Granularity,
  hasAnyData: boolean,
  modelNames: string[],
): WidgetDef {
  return {
    id: 'cost-by-model',
    title: t('panel.costByModel.title'),
    description: t('widgets.cost-by-model.description'),
    category: 'chart',
    sizes: [{ w: 4, h: 2 }, { w: 4, h: 3 }, { w: 2, h: 3 }, { w: 2, h: 2 }],
    minW: 2,
    minH: 2,
    render: ({ h }) => (
      <div className="panel widget-panel">
        <PanelHeader
          title={t('panel.costByModel.title')}
          sub={t(granularity === 'day' ? 'panel.costByModel.subDay' : granularity === 'week' ? 'panel.costByModel.subWeek' : 'panel.costByModel.subMonth')}
          help={t('panel.costByModel.help')}
        />
        <div className="widget-panel-body widget-chart-body">
          {hasAnyData ? (
            <div className="widget-chart-area">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} margin={TIMESERIES_MARGIN} barCategoryGap="15%">
                  <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="_label" tickLine={false} axisLine={{ stroke: 'var(--grid)' }} interval="preserveStartEnd" hide={h <= 1} />
                  <YAxis tickLine={false} axisLine={{ stroke: 'var(--grid)' }} tickFormatter={v => `$${v}`} width={TIMESERIES_YAXIS_WIDTH} />
                  <Tooltip content={<SeriesTooltip />} cursor={{ fill: 'var(--hover)' }} animationDuration={0} isAnimationActive={false} />
                  {h >= 3 && <Legend wrapperStyle={{ paddingTop: 8 }} iconType="square" />}
                  {modelNames.map((m, i) => {
                    const isLast = i === modelNames.length - 1
                    return (
                      <Bar key={m} dataKey={`model:${m}`} name={m} stackId="cost" fill={COLORS[i % COLORS.length]}
                        radius={isLast ? [3, 3, 0, 0] : 0} isAnimationActive={false} />
                    )
                  })}
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (<ChartEmpty />)}
        </div>
      </div>
    ),
  }
}
