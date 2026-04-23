import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { Granularity } from '../../types'
import { ChartEmpty, PanelHeader } from '../../components/widgets-misc'
import { fmtInt } from '../../lib/format'
import { CallsTooltip } from '../tooltips'
import { TIMESERIES_MARGIN, TIMESERIES_YAXIS_WIDTH } from '../panels'

export function callsWidget(
  t: T,
  series: Array<Record<string, number | string>>,
  granularity: Granularity,
  hasAnyData: boolean,
): WidgetDef {
  return {
    id: 'calls',
    title: t('panel.calls.title'),
    description: t('widgets.calls.description'),
    category: 'chart',
    sizes: [{ w: 4, h: 2 }, { w: 2, h: 2 }, { w: 2, h: 3 }, { w: 4, h: 3 }],
    minW: 2,
    minH: 2,
    render: ({ h }) => (
      <div className="panel widget-panel">
        <PanelHeader
          title={t('panel.calls.title')}
          sub={t(granularity === 'day' ? 'panel.calls.subDay' : granularity === 'week' ? 'panel.calls.subWeek' : 'panel.calls.subMonth')}
          help={t('panel.calls.help')}
        />
        <div className="widget-panel-body widget-chart-body">
          {hasAnyData ? (
            <div className="widget-chart-area">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} margin={TIMESERIES_MARGIN} barCategoryGap="15%">
                  <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="_label" tickLine={false} axisLine={{ stroke: 'var(--grid)' }} interval="preserveStartEnd" hide={h <= 1} />
                  <YAxis tickLine={false} axisLine={{ stroke: 'var(--grid)' }} tickFormatter={fmtInt} width={TIMESERIES_YAXIS_WIDTH} />
                  <Tooltip content={<CallsTooltip />} cursor={{ fill: 'var(--hover)' }} animationDuration={0} isAnimationActive={false} />
                  <Bar dataKey="calls" fill="var(--chart-2)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (<ChartEmpty />)}
        </div>
      </div>
    ),
  }
}
