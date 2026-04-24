import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import { ChartEmpty, PanelHeader } from '../../components/widgets-misc'
import { fmtCurrency } from '../../lib/format'
import { CallsTooltip } from '../tooltips'
import { TIMESERIES_MARGIN, TIMESERIES_YAXIS_WIDTH } from '../panels'

/** Day-view exclusive widget: 24 bars (one per hour of the selected
 *  day) of cost. Pure cost view keeps the bar axis simple — calls /
 *  tokens stories live in their own widgets if added later. */
export function hourTimelineWidget(
  t: T,
  series: Array<Record<string, number | string>>,
  hasAnyData: boolean,
): WidgetDef {
  return {
    id: 'hour-timeline',
    title: t('panel.hourTimeline.title'),
    description: t('widgets.hour-timeline.description'),
    category: 'chart',
    sizes: [{ w: 4, h: 3 }, { w: 4, h: 2 }, { w: 2, h: 2 }],
    minW: 2,
    minH: 2,
    render: ({ h }) => (
      <div className="panel widget-panel">
        <PanelHeader
          title={t('panel.hourTimeline.title')}
          sub={t('panel.hourTimeline.sub')}
          help={t('panel.hourTimeline.help')}
        />
        <div className="widget-panel-body widget-chart-body">
          {hasAnyData ? (
            <div className="widget-chart-area">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} margin={TIMESERIES_MARGIN} barCategoryGap="15%">
                  <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="_label" tickLine={false} axisLine={{ stroke: 'var(--grid)' }} interval="preserveStartEnd" hide={h <= 1} />
                  <YAxis tickLine={false} axisLine={{ stroke: 'var(--grid)' }} tickFormatter={v => `$${v}`} width={TIMESERIES_YAXIS_WIDTH} />
                  <Tooltip content={<CallsTooltip />} cursor={{ fill: 'var(--hover)' }} animationDuration={0} isAnimationActive={false} />
                  <Bar dataKey="cost" fill="var(--chart-1)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (<ChartEmpty hint={t('panel.hourTimeline.empty')} />)}
        </div>
      </div>
    ),
  }
}
// fmtCurrency kept available in case we add a totals strip later.
void fmtCurrency
