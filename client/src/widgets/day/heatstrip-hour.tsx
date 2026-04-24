import { useMemo, useState } from 'react'
import type { WidgetDef } from '../grid'
import type { T } from '../../i18n'
import { PanelHeader } from '../../components/widgets-misc'
import { fmtCurrency } from '../../lib/format'
import { TooltipPortal } from '../tooltips'

/** Variant A — single-row 24-cell strip for the selected day. Each
 *  cell = one hour, color intensity scales with cost. Compact alt to
 *  the hour-timeline bar chart; the same data, different visual. */
export function hoursHeatstripWidget(
  t: T,
  series: Array<Record<string, number | string>>,
): WidgetDef {
  return {
    id: 'hours-heatstrip',
    title: t('panel.hoursHeatstrip.title'),
    description: t('widgets.hours-heatstrip.description'),
    category: 'chart',
    sizes: [{ w: 4, h: 1 }, { w: 2, h: 1 }, { w: 4, h: 2 }],
    minW: 2,
    minH: 1,
    render: () => <HoursHeatstrip t={t} series={series} />,
  }
}

function HoursHeatstrip({ t, series }: { t: T; series: Array<Record<string, number | string>> }) {
  const cells = useMemo(() => {
    const byHour: number[] = Array(24).fill(0)
    for (const row of series) {
      const bucket = String(row.bucket)
      const m = bucket.match(/(\d{2}):00$/)
      if (!m) continue
      byHour[parseInt(m[1], 10)] = Number(row.cost) || 0
    }
    const max = Math.max(0.001, ...byHour)
    return byHour.map(v => ({ cost: v, intensity: v / max }))
  }, [series])

  const [hover, setHover] = useState<number | null>(null)

  return (
    <div className="panel widget-panel">
      <PanelHeader
        title={t('panel.hoursHeatstrip.title')}
        sub={t('panel.hoursHeatstrip.sub')}
        help={t('panel.hoursHeatstrip.help')}
      />
      <div className="widget-panel-body heatstrip-body">
        <div className="heatstrip">
          {cells.map((c, h) => (
            <div
              key={h}
              className={`heatstrip-cell${hover === h ? ' is-hover' : ''}`}
              style={{ background: c.cost > 0 ? `rgba(255, 140, 66, ${0.15 + c.intensity * 0.85})` : 'var(--bg-2)' }}
              onMouseEnter={() => setHover(h)}
              onMouseLeave={() => setHover(prev => (prev === h ? null : prev))}
            />
          ))}
        </div>
        <div className="heatstrip-axis">
          <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
        </div>
      </div>
      <TooltipPortal active={hover !== null}>
        {hover !== null && (
          <div className="tooltip">
            <div className="tt-title">{String(hover).padStart(2, '0')}:00–{String((hover + 1) % 24).padStart(2, '0')}:00</div>
            <div className="tt-row"><span>{t('kpi.spend')}</span><span className="tt-val">{fmtCurrency(cells[hover].cost)}</span></div>
          </div>
        )}
      </TooltipPortal>
    </div>
  )
}
