import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { OverviewResponse } from '../../types'
import { PanelHeader } from '../../components/widgets-misc'
import { fmtCurrency, parseLocalDate, toInputDate } from '../../lib/format'
import { apiGet, dashboardParams } from '../../api'
import { TooltipPortal } from '../tooltips'

const HOURS = 24
const ROWS = 7
const DAY_LABEL_W = 36
const HOUR_LABEL_H = 14
const GAP = 2
const MIN_CELL = 8
const WINDOW_DAYS = 90 // span we aggregate weekday × hour patterns over

/** Variant C — 7×24 day-of-week × hour heatmap. Same shape as the
 *  project-page heatmap, but scoped to the whole user (no project
 *  filter). Shows "when do I usually work" patterns rather than
 *  specific days. */
export function weekdayHourHeatmapWidget(
  t: T,
  selectedDate: string,
  providersParam: string,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6,
): WidgetDef {
  return {
    id: 'weekday-hour-heatmap',
    title: t('panel.weekdayHourHeatmap.title'),
    description: t('widgets.weekday-hour-heatmap.description'),
    category: 'chart',
    sizes: [{ w: 4, h: 2 }, { w: 4, h: 3 }, { w: 2, h: 3 }],
    minW: 2,
    minH: 2,
    render: () => (
      <WeekdayHourHeatmap
        t={t}
        selectedDate={selectedDate}
        providersParam={providersParam}
        weekStartsOn={weekStartsOn}
      />
    ),
  }
}

function WeekdayHourHeatmap({ t, selectedDate, providersParam, weekStartsOn }: {
  t: T
  selectedDate: string
  providersParam: string
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6
}) {
  const dayNames = [t('day.sun'), t('day.mon'), t('day.tue'), t('day.wed'), t('day.thu'), t('day.fri'), t('day.sat')]
  const rowOrder = Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7)

  const range = useMemo(() => {
    const end = parseLocalDate(selectedDate)
    const start = new Date(end)
    start.setDate(end.getDate() - (WINDOW_DAYS - 1))
    return { start, end }
  }, [selectedDate])

  const queryKey = ['overview', toInputDate(range.start), toInputDate(range.end), 'hour', providersParam, '', weekStartsOn]
  const q = useQuery<OverviewResponse>({
    queryKey,
    queryFn: () => apiGet<OverviewResponse>(`/api/overview?${dashboardParams({
      start: range.start, end: range.end, providers: providersParam, granularity: 'hour', weekStartsOn,
    })}`),
    placeholderData: keepPreviousData,
  })

  // Aggregate hourly cost across the window into a 7×24 dow × hour grid.
  const grid = useMemo(() => {
    const m: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
    let max = 0
    for (const row of q.data?.series ?? []) {
      const bucket = String(row.bucket)
      const mm = bucket.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):00$/)
      if (!mm) continue
      const dow = parseLocalDate(mm[1]).getDay()
      const hour = parseInt(mm[2], 10)
      const v = Number(row.cost) || 0
      m[dow][hour] += v
      if (m[dow][hour] > max) max = m[dow][hour]
    }
    return { m, max: Math.max(max, 0.001) }
  }, [q.data])

  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const cellByW = (box.w - DAY_LABEL_W - GAP * HOURS) / HOURS
  const cellByH = (box.h - HOUR_LABEL_H - GAP * ROWS) / ROWS
  const cell = Math.floor(Math.min(cellByW, cellByH))

  const [hover, setHover] = useState<{ dow: number; hour: number } | null>(null)

  return (
    <div className="panel widget-panel">
      <PanelHeader
        title={t('panel.weekdayHourHeatmap.title')}
        sub={t('panel.weekdayHourHeatmap.subFmt', { days: WINDOW_DAYS })}
        help={t('panel.weekdayHourHeatmap.help')}
      />
      <div className="widget-panel-body heatmap-fit" ref={ref}>
        {box.w === 0 || box.h === 0 ? null : cell < MIN_CELL ? (
          <div className="heatmap-fallback">{t('insights.heatmap.tooSmall')}</div>
        ) : (
          <div className="heatmap" style={{ '--cell-size': `${cell}px` } as React.CSSProperties}>
            <div className="heatmap-hours">
              <div className="heatmap-corner" />
              {Array.from({ length: HOURS }, (_, h) => (
                <div className={`heatmap-hour${hover?.hour === h ? ' is-hover' : ''}`} key={h}>{h % 3 === 0 ? h : ''}</div>
              ))}
            </div>
            {rowOrder.map(dow => (
              <div className="heatmap-row" key={dow}>
                <div className={`heatmap-day${hover?.dow === dow ? ' is-hover' : ''}`}>{dayNames[dow]}</div>
                {grid.m[dow].map((cost, hour) => {
                  const intensity = cost / grid.max
                  const isHover = hover?.dow === dow && hover?.hour === hour
                  return (
                    <div
                      key={hour}
                      className={`heatmap-cell${isHover ? ' is-hover' : ''}`}
                      style={{ background: cost > 0 ? `rgba(255, 140, 66, ${0.15 + intensity * 0.85})` : 'var(--bg-2)' }}
                      onMouseEnter={() => setHover({ dow, hour })}
                      onMouseLeave={() => setHover(prev => (prev?.dow === dow && prev?.hour === hour ? null : prev))}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>
      <TooltipPortal active={!!hover}>
        {hover && (
          <div className="tooltip">
            <div className="tt-title">{dayNames[hover.dow]} · {String(hover.hour).padStart(2, '0')}:00–{String((hover.hour + 1) % 24).padStart(2, '0')}:00</div>
            <div className="tt-row"><span>{t('kpi.spend')}</span><span className="tt-val">{fmtCurrency(grid.m[hover.dow][hover.hour])}</span></div>
          </div>
        )}
      </TooltipPortal>
    </div>
  )
}

