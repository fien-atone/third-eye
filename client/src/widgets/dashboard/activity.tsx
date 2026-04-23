import { useLayoutEffect, useRef, useState } from 'react'
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { OverviewResponse } from '../../types'
import { ChartEmpty, HelpTip, WidgetListMore } from '../../components/widgets-misc'
import { RowTooltip } from '../tooltips'

const PER_BAR_PX = 32     // target visible row height per bar
const FOOTER_PX = 36      // truncation chip
const X_AXIS_PX = 30      // recharts default X-axis area
const MIN_BAR_AREA = 28   // below this, even one bar is unreadable

function ActivityBody({ categories }: { categories: OverviewResponse['categories'] }) {
  const areaRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  const [areaH, setAreaH] = useState(0)
  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setAreaH(e.contentRect.height))
    ro.observe(el)
    setAreaH(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  // Two-phase fit: we have to fit the chart AND a chip footer in
  // the panel body. The X-axis itself eats ~30px before any bar is
  // drawn, so on a 70px tile we'd be left with 14px for the bar and
  // the user sees only an empty axis line. Hide the X-axis when bars
  // would otherwise be invisible.
  const reserveFooter = categories.length > 0 ? FOOTER_PX : 0
  const chartH = Math.max(0, areaH - reserveFooter)
  const showXAxis = chartH >= 100
  const usableForBars = chartH - (showXAxis ? X_AXIS_PX : 0)
  let visibleCount: number
  if (areaH === 0) {
    visibleCount = categories.length // initial render before measure
  } else if (usableForBars < MIN_BAR_AREA) {
    visibleCount = 0
  } else {
    visibleCount = Math.min(categories.length, Math.max(1, Math.floor(usableForBars / PER_BAR_PX)))
  }
  const visibleCats = categories.slice(0, visibleCount)
  return (
    <>
      <div className="widget-chart-area" ref={areaRef}>
        {visibleCount > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={visibleCats} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tickFormatter={v => `$${v}`} tickLine={false} axisLine={{ stroke: 'var(--grid)' }} hide={!showXAxis} />
              <YAxis type="category" dataKey="name" tickLine={false} axisLine={{ stroke: 'var(--grid)' }} width={110} interval={0} />
              <Tooltip content={<RowTooltip />} cursor={{ fill: 'var(--hover)' }} animationDuration={0} isAnimationActive={false} />
              <Bar dataKey="cost" fill="var(--chart-1)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        ) : null}
      </div>
      <WidgetListMore ref={footerRef} shown={visibleCount} total={categories.length} />
    </>
  )
}

export function activityWidget(t: T, data: OverviewResponse): WidgetDef {
  return {
    id: 'activity',
    title: t('panel.activity.title'),
    description: t('widgets.activity.description'),
    category: 'chart',
    sizes: [{ w: 2, h: 2 }, { w: 4, h: 2 }, { w: 2, h: 3 }, { w: 4, h: 3 }],
    minW: 2,
    minH: 2,
    render: () => (
      <div className="panel widget-panel">
        <div className="panel-head">
          <div className="panel-title-row">
            <h3 style={{ margin: 0 }}>{t('panel.activity.title')}</h3>
            <HelpTip>{t('panel.activity.help')}</HelpTip>
          </div>
        </div>
        <div className="widget-panel-body widget-chart-body">
          {data.categories.length === 0 ? <ChartEmpty /> : (
            <ActivityBody categories={data.categories} />
          )}
        </div>
      </div>
    ),
  }
}
