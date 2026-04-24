import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { format } from 'date-fns'
import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { OverviewResponse } from '../../types'
import { PanelHeader } from '../../components/widgets-misc'
import { useDateLocale, fmtCurrency, parseLocalDate, toInputDate } from '../../lib/format'
import { apiGet, dashboardParams } from '../../api'
import { TooltipPortal } from '../tooltips'

const HOURS = 24
const DAY_LABEL_W = 36
const HOUR_LABEL_H = 14
const GAP = 1
const MIN_CELL = 6

/** Variant B — N days × 24 hours grid. Click any day cell to navigate
 *  to that day. Doubles as a date picker AND an hour-pattern view
 *  (visible weekend gaps, lunch breaks, etc.). `daysCount` controls
 *  the rolling window (caller picks 30 for "month at a glance" or 7
 *  for "this week"). */
export function daysHoursHeatmapWidget(
  t: T,
  opts: {
    id: string
    daysCount: number
    titleKey: string
    subKey: string
    descKey: string
  },
  selectedDate: string,
  providersParam: string,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6,
  onSelectDate: (d: string) => void,
): WidgetDef {
  return {
    id: opts.id,
    title: t(opts.titleKey as never),
    description: t(opts.descKey as never),
    category: 'chart',
    sizes: [{ w: 4, h: 3 }, { w: 4, h: 4 }, { w: 2, h: 3 }],
    minW: 2,
    minH: 2,
    render: () => (
      <DaysHoursHeatmap
        t={t}
        daysCount={opts.daysCount}
        titleKey={opts.titleKey}
        subKey={opts.subKey}
        selectedDate={selectedDate}
        providersParam={providersParam}
        weekStartsOn={weekStartsOn}
        onSelectDate={onSelectDate}
      />
    ),
  }
}

function DaysHoursHeatmap({ t, daysCount, titleKey, subKey, selectedDate, providersParam, weekStartsOn, onSelectDate }: {
  t: T
  daysCount: number
  titleKey: string
  subKey: string
  selectedDate: string
  providersParam: string
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6
  onSelectDate: (d: string) => void
}) {
  const DAYS = daysCount
  const dl = useDateLocale()

  // Window is the DAYS-1 days BEFORE selected day plus selected day itself.
  // Centred-around would shift on every navigation; ending-at gives a
  // stable "look back" view that always keeps the selected day visible.
  const range = useMemo(() => {
    const end = parseLocalDate(selectedDate)
    const start = new Date(end)
    start.setDate(end.getDate() - (DAYS - 1))
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

  // Build a date → hour[] cost matrix from the hourly series.
  const matrix = useMemo(() => {
    const byDate = new Map<string, number[]>()
    let max = 0
    // Newest day (= the selected one) first so the row order matches
    // how people read date timelines: today on top, older below.
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(range.start)
      d.setDate(range.start.getDate() + i)
      byDate.set(toInputDate(d), Array(HOURS).fill(0))
    }
    for (const row of q.data?.series ?? []) {
      const bucket = String(row.bucket)
      const m = bucket.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):00$/)
      if (!m) continue
      const arr = byDate.get(m[1])
      if (!arr) continue
      const v = Number(row.cost) || 0
      arr[parseInt(m[2], 10)] = v
      if (v > max) max = v
    }
    return { byDate, max: Math.max(max, 0.001) }
  }, [q.data, range.start])

  const days = useMemo(() => Array.from(matrix.byDate.entries()).map(([dateStr, hours]) => {
    const dayTotal = hours.reduce((s, v) => s + v, 0)
    return { dateStr, hours, dayTotal }
  }), [matrix])

  // Container measure → cell size that fits both axes.
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

  const cellW = (box.w - DAY_LABEL_W - GAP * HOURS) / HOURS
  const cellH = (box.h - HOUR_LABEL_H - GAP * DAYS) / DAYS
  const cell = Math.floor(Math.min(cellW, cellH))

  const [hover, setHover] = useState<{ dateStr: string; hour: number } | null>(null)

  return (
    <div className="panel widget-panel">
      <PanelHeader
        title={t(titleKey as never)}
        sub={t(subKey as never, { days: DAYS })}
        help={t('panel.daysHoursHeatmap.help')}
      />
      <div className="widget-panel-body day-heatmap-fit" ref={ref}>
        {box.w === 0 || box.h === 0 ? null : cell < MIN_CELL ? (
          <div className="heatmap-fallback">{t('insights.heatmap.tooSmall')}</div>
        ) : (
          <div className="day-heatmap" style={{ '--cell-size': `${cell}px` } as React.CSSProperties}>
            <div className="day-heatmap-hours">
              <div className="day-heatmap-corner" />
              {Array.from({ length: HOURS }, (_, h) => (
                <div className="day-heatmap-hour-label" key={h}>{h % 3 === 0 ? h : ''}</div>
              ))}
            </div>
            {days.map(d => {
              const isSelected = d.dateStr === selectedDate
              return (
                <div className={`day-heatmap-row${isSelected ? ' is-selected' : ''}`} key={d.dateStr}>
                  <button
                    className="day-heatmap-day-label"
                    onClick={() => onSelectDate(d.dateStr)}
                    title={format(parseLocalDate(d.dateStr), 'EEEE, d MMMM yyyy', { locale: dl })}
                  >
                    <span className="day-heatmap-day-num">{format(parseLocalDate(d.dateStr), 'd', { locale: dl })}</span>
                    <span className="day-heatmap-day-mon">{format(parseLocalDate(d.dateStr), 'MMM', { locale: dl })}</span>
                  </button>
                  {d.hours.map((cost, hour) => {
                    const intensity = cost / matrix.max
                    const isHover = hover?.dateStr === d.dateStr && hover?.hour === hour
                    return (
                      <div
                        key={hour}
                        className={`day-heatmap-cell${isHover ? ' is-hover' : ''}`}
                        style={{ background: cost > 0 ? `rgba(255, 140, 66, ${0.15 + intensity * 0.85})` : 'var(--bg-2)' }}
                        onMouseEnter={() => setHover({ dateStr: d.dateStr, hour })}
                        onMouseLeave={() => setHover(prev => (prev?.dateStr === d.dateStr && prev?.hour === hour ? null : prev))}
                        onClick={() => onSelectDate(d.dateStr)}
                      />
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </div>
      <TooltipPortal active={!!hover}>
        {hover && (() => {
          const d = matrix.byDate.get(hover.dateStr)
          const v = d ? d[hover.hour] : 0
          return (
            <div className="tooltip">
              <div className="tt-title">
                {format(parseLocalDate(hover.dateStr), 'EEE, d MMM', { locale: dl })} · {String(hover.hour).padStart(2, '0')}:00–{String((hover.hour + 1) % 24).padStart(2, '0')}:00
              </div>
              <div className="tt-row"><span>{t('kpi.spend')}</span><span className="tt-val">{fmtCurrency(v)}</span></div>
            </div>
          )
        })()}
      </TooltipPortal>
    </div>
  )
}
