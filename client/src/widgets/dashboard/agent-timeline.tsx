/**
 * Agent timeline — stacked bar chart of daily cost per configured
 * agent. Shows "which agents worked on which day", aligned with the
 * rest of the dashboard's time-series widgets (same granularity,
 * same bucket labels).
 *
 * Data source: data.agentTelemetry.timeline.series — one row per
 * bucket with `agent:<role>` keys for each distinct configured agent.
 * We merge the main series' _label into each row so the x-axis
 * matches other widgets exactly.
 */

import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { Granularity, OverviewResponse } from '../../types'
import { ChartEmpty, PanelHeader } from '../../components/widgets-misc'
import { COLORS } from '../../lib/format'
import { SeriesTooltip } from '../tooltips'
import { TIMESERIES_MARGIN, TIMESERIES_YAXIS_WIDTH } from '../panels'

export function agentTimelineWidget(
  t: T,
  data: OverviewResponse,
  series: Array<Record<string, number | string>>,
  granularity: Granularity,
): WidgetDef {
  const { timeline } = data.agentTelemetry
  const roles = timeline.roles
  // Build label lookup from the main dashboard series (which has
  // _label/_labelFull) so our x-axis ticks match other widgets.
  const labelByBucket = new Map<string, { label: string; labelFull: string }>()
  for (const row of series) {
    labelByBucket.set(
      String(row.bucket),
      {
        label: String(row._label ?? row.bucket),
        labelFull: String(row._labelFull ?? row.bucket),
      },
    )
  }
  const chartSeries = timeline.series.map(row => {
    const bucket = String(row.bucket)
    const labels = labelByBucket.get(bucket)
    return {
      ...row,
      _label: labels?.label ?? bucket,
      _labelFull: labels?.labelFull ?? bucket,
    }
  })
  const hasAnyData = roles.length > 0 && chartSeries.some((r: Record<string, unknown>) =>
    roles.some(role => (Number(r[`agent:${role}`]) || 0) > 0)
  )

  const subByGranularity: Record<Granularity, string> = {
    hour: t('agents.timeline.subHour'),
    day: t('agents.timeline.subDay'),
    week: t('agents.timeline.subWeek'),
    month: t('agents.timeline.subMonth'),
  }

  return {
    id: 'agent-timeline',
    title: t('agents.timeline.title'),
    description: t('agents.timeline.desc'),
    category: 'chart',
    section: 'agents',
    // Ordered smallest → largest. Picker auto-selects the largest
    // fitting size for the target slot.
    sizes: [{ w: 2, h: 2 }, { w: 2, h: 3 }, { w: 4, h: 2 }, { w: 4, h: 3 }],
    minW: 2,
    minH: 2,
    render: ({ h }) => (
      <div className="panel widget-panel">
        <PanelHeader
          title={t('agents.timeline.title')}
          sub={subByGranularity[granularity]}
          help={t('agents.timeline.help')}
        />
        <div className="widget-panel-body widget-chart-body">
          {hasAnyData ? (
            <div className="widget-chart-area">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartSeries} margin={TIMESERIES_MARGIN} barCategoryGap="15%">
                  <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="_label" tickLine={false} axisLine={{ stroke: 'var(--grid)' }} interval="preserveStartEnd" hide={h <= 1} />
                  <YAxis tickLine={false} axisLine={{ stroke: 'var(--grid)' }} tickFormatter={v => `$${v}`} width={TIMESERIES_YAXIS_WIDTH} />
                  <Tooltip content={<SeriesTooltip />} cursor={{ fill: 'var(--hover)' }} animationDuration={0} isAnimationActive={false} />
                  {h >= 3 && <Legend wrapperStyle={{ paddingTop: 8 }} iconType="square" />}
                  {roles.map((role, i) => {
                    const isLast = i === roles.length - 1
                    return (
                      <Bar
                        key={role}
                        dataKey={`agent:${role}`}
                        name={role}
                        stackId="cost"
                        fill={COLORS[i % COLORS.length]}
                        radius={isLast ? [3, 3, 0, 0] : 0}
                        isAnimationActive={false}
                      />
                    )
                  })}
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (<ChartEmpty hint={t('agents.timeline.empty')} />)}
        </div>
      </div>
    ),
  }
}
