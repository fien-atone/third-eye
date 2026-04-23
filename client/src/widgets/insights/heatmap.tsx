import { useLayoutEffect, useRef, useState } from 'react'
import type { Locale } from 'date-fns'
import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import type { InsightsResponse } from '../../types'
import { PanelHeader } from '../../components/widgets-misc'
import { useT } from '../../i18n'
import { TooltipPortal } from '../tooltips'
import { fmtInt } from '../../lib/format'

const COLS = 24
const ROWS = 7
const DAY_LABEL_W = 32
const HOUR_LABEL_H = 14
const GAP = 2
const MIN_CELL = 8 // below this the heatmap is unreadable — show fallback

function HeatmapBody({ heatGrid, heatMax, rowOrder, dayNames }: {
  heatGrid: number[][]
  heatMax: number
  rowOrder: number[]
  dayNames: string[]
}) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<{ dow: number; hour: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // Compute the largest square cell that lets the whole 7×24 grid fit
  // inside the available body box on BOTH axes. `aspect-ratio: 1/1` in
  // the original CSS only constrained one axis at a time, which let the
  // grid overflow when the widget was tall but narrow (or vice versa).
  const widthBudget = box.w - DAY_LABEL_W - GAP * COLS
  const heightBudget = box.h - HOUR_LABEL_H - GAP * ROWS
  const cellByW = widthBudget > 0 ? widthBudget / COLS : 0
  const cellByH = heightBudget > 0 ? heightBudget / ROWS : 0
  const cell = Math.floor(Math.min(cellByW, cellByH))

  if (box.w === 0 || box.h === 0) return <div ref={ref} className="heatmap-fit" />

  if (cell < MIN_CELL) {
    return (
      <div ref={ref} className="heatmap-fit heatmap-fallback">
        <div>{t('insights.heatmap.tooSmall')}</div>
      </div>
    )
  }

  return (
    <div ref={ref} className="heatmap-fit">
      <div className="heatmap" style={{ '--cell-size': `${cell}px` } as React.CSSProperties}>
        <div className="heatmap-hours">
          <div className="heatmap-corner" />
          {Array.from({ length: COLS }, (_, h) => (
            <div className={`heatmap-hour${hover?.hour === h ? ' is-hover' : ''}`} key={h}>{h % 3 === 0 ? h : ''}</div>
          ))}
        </div>
        {rowOrder.map(dow => (
          <div className="heatmap-row" key={dow}>
            <div className={`heatmap-day${hover?.dow === dow ? ' is-hover' : ''}`}>{dayNames[dow]}</div>
            {heatGrid[dow].map((calls, hour) => {
              const intensity = heatMax > 0 ? calls / heatMax : 0
              const isHover = hover?.dow === dow && hover?.hour === hour
              return (
                <div
                  key={hour}
                  className={`heatmap-cell${isHover ? ' is-hover' : ''}`}
                  style={{ background: intensity > 0 ? `rgba(255, 140, 66, ${0.15 + intensity * 0.85})` : 'var(--bg-2)' }}
                  onMouseEnter={() => setHover({ dow, hour })}
                  onMouseLeave={() => setHover(h => (h && h.dow === dow && h.hour === hour ? null : h))}
                />
              )
            })}
          </div>
        ))}
      </div>
      <TooltipPortal active={!!hover}>
        {hover && (
          <div className="tooltip">
            <div className="tt-title">{dayNames[hover.dow]} · {String(hover.hour).padStart(2, '0')}:00–{String((hover.hour + 1) % 24).padStart(2, '0')}:00</div>
            <div className="tt-row"><span>{t('insights.heatmap.cellCalls')}</span><span className="tt-val">{fmtInt(heatGrid[hover.dow][hover.hour])}</span></div>
          </div>
        )}
      </TooltipPortal>
    </div>
  )
}

export function heatmapWidget(t: T, data: InsightsResponse, dl: Locale): WidgetDef {
  const weekStartsOn = (dl.options?.weekStartsOn ?? 1) as 0 | 1 | 2 | 3 | 4 | 5 | 6
  const dayNames = [t('day.sun'), t('day.mon'), t('day.tue'), t('day.wed'), t('day.thu'), t('day.fri'), t('day.sat')]
  const rowOrder = Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7)
  const heatGrid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  let heatMax = 0
  for (const c of data.heatmap) {
    heatGrid[c.dow][c.hour] = c.calls
    if (c.calls > heatMax) heatMax = c.calls
  }
  return {
    id: 'heatmap',
    title: t('insights.heatmap.title'),
    description: t('widgets.heatmap.description'),
    category: 'insights',
    sizes: [{ w: 4, h: 2 }, { w: 4, h: 3 }, { w: 2, h: 3 }],
    minW: 2,
    minH: 2,
    render: () => (
      <div className="panel widget-panel">
        <PanelHeader title={t('insights.heatmap.title')} sub={t('insights.heatmap.sub')} help={t('insights.heatmap.help')} />
        <HeatmapBody heatGrid={heatGrid} heatMax={heatMax} rowOrder={rowOrder} dayNames={dayNames} />
      </div>
    ),
  }
}
