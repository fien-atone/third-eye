/** Recharts tooltip components for the dashboard charts.
 *  All share the `.tooltip` CSS class — see index.css for styling. */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { fmtCurrency, fmtInt, fmtTokens } from '../lib/format'
import type { TTProps } from '../types'

/** Render `children` (a tooltip body) at the document root, anchored at
 *  the current cursor position. Recharts clips its built-in tooltip to
 *  the chart wrapper, which is fine on a full-page chart but causes the
 *  popup to disappear off the edge inside small dashboard widgets
 *  (overflow:hidden on .grid-stack-item-content cuts it off). The
 *  portal escapes every clipping ancestor; cursor tracking via a global
 *  mousemove keeps positioning sensible across browser quirks. */
export function TooltipPortal({ active, children }: { active: boolean; children: ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const lastMove = useRef(0)
  useEffect(() => {
    if (!active) { setPos(null); return }
    const onMove = (e: MouseEvent) => {
      const now = performance.now()
      if (now - lastMove.current < 16) return // ~60fps cap
      lastMove.current = now
      setPos({ x: e.clientX, y: e.clientY })
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => window.removeEventListener('mousemove', onMove)
  }, [active])
  if (!active || !pos) return null
  // Flip horizontally / vertically near viewport edges so the popup
  // never overflows the visible window.
  const PAD = 12
  const ESTIMATE_W = 240
  const ESTIMATE_H = 160
  const flipRight = pos.x + ESTIMATE_W + PAD > window.innerWidth
  const flipUp = pos.y + ESTIMATE_H + PAD > window.innerHeight
  const left = flipRight ? pos.x - ESTIMATE_W - PAD : pos.x + PAD
  const top  = flipUp    ? pos.y - ESTIMATE_H - PAD : pos.y + PAD
  return createPortal(
    <div style={{
      position: 'fixed',
      left: Math.max(4, left),
      top: Math.max(4, top),
      zIndex: 1000,
      pointerEvents: 'none',
    }}>{children}</div>,
    document.body,
  )
}

export function SeriesTooltip({ active, payload, label }: TTProps) {
  const ok = !!active && !!payload && payload.length > 0
  const items = ok ? payload.filter(p => p.dataKey && String(p.dataKey).startsWith('model:') && p.value > 0) : []
  const totalCost = items.reduce((s, p) => s + (p.value ?? 0), 0)
  const title = (ok && payload[0]?.payload?._labelFull) || label
  return (
    <TooltipPortal active={ok && items.length > 0}>
      <div className="tooltip">
        <div className="tt-title">{title}</div>
        <div className="tt-row"><span>Total</span><span className="tt-val">{fmtCurrency(totalCost)}</span></div>
        <div style={{ height: 6, borderTop: '1px solid var(--border)', marginTop: 4 }} />
        {items.sort((a, b) => b.value - a.value).map(p => (
          <div className="tt-row" key={p.dataKey}>
            <span><span className="swatch" style={{ background: p.color }} />{String(p.dataKey).replace('model:', '')}</span>
            <span className="tt-val">{fmtCurrency(p.value)}</span>
          </div>
        ))}
      </div>
    </TooltipPortal>
  )
}

export function CallsTooltip({ active, payload, label }: TTProps) {
  const ok = !!active && !!payload && payload.length > 0
  const title = (ok && payload![0]?.payload?._labelFull) || label
  return (
    <TooltipPortal active={ok}>
      <div className="tooltip">
        <div className="tt-title">{title}</div>
        <div className="tt-row"><span>API calls</span><span className="tt-val">{ok ? fmtInt(payload![0].value) : ''}</span></div>
      </div>
    </TooltipPortal>
  )
}

export function TokenTooltip({ active, payload, label }: TTProps) {
  const ok = !!active && !!payload && payload.length > 0
  const title = (ok && payload![0]?.payload?._labelFull) || label
  return (
    <TooltipPortal active={ok}>
      <div className="tooltip">
        <div className="tt-title">{title}</div>
        {ok && payload!.map(p => (
          <div className="tt-row" key={p.dataKey}>
            <span><span className="swatch" style={{ background: p.color }} />{p.name}</span>
            <span className="tt-val">{fmtTokens(p.value)}</span>
          </div>
        ))}
      </div>
    </TooltipPortal>
  )
}

export function RowTooltip({ active, payload }: TTProps) {
  const ok = !!active && !!payload && payload.length > 0
  const d = ok ? payload![0]?.payload : null
  return (
    <TooltipPortal active={ok && !!d}>
      {d && (
        <div className="tooltip">
          <div className="tt-title">{d.name}</div>
          <div className="tt-row"><span>Cost</span><span className="tt-val">{fmtCurrency(d.cost)}</span></div>
          {d.calls !== undefined && <div className="tt-row"><span>Calls</span><span className="tt-val">{fmtInt(d.calls)}</span></div>}
        </div>
      )}
    </TooltipPortal>
  )
}

export function ProjectSeriesTooltip({ active, payload, label, entries }: TTProps & { entries: Array<{ dataKey: string; label: string; color: string }> }) {
  const ok = !!active && !!payload && payload.length > 0
  const items = ok ? payload.filter(p => p.value > 0) : []
  const total = items.reduce((s, p) => s + (p.value ?? 0), 0)
  const byKey = new Map(entries.map(e => [e.dataKey, e]))
  const title = (ok && payload[0]?.payload?._labelFull) || label
  return (
    <TooltipPortal active={ok && items.length > 0}>
      <div className="tooltip">
        <div className="tt-title">{title}</div>
        <div className="tt-row"><span>Total</span><span className="tt-val">{fmtCurrency(total)}</span></div>
        <div style={{ height: 6, borderTop: '1px solid var(--border)', marginTop: 4 }} />
        {items.sort((a, b) => b.value - a.value).map(p => {
          const entry = byKey.get(String(p.dataKey))
          const name = entry?.label ?? String(p.dataKey).replace('project:', '')
          return (
            <div className="tt-row" key={p.dataKey}>
              <span><span className="swatch" style={{ background: p.color }} />{name}</span>
              <span className="tt-val">{fmtCurrency(p.value)}</span>
            </div>
          )
        })}
      </div>
    </TooltipPortal>
  )
}

export function VersionTooltip({ active, payload, total, fmt }: TTProps & { total: number; fmt: (v: number) => string }) {
  const ok = !!active && !!payload && payload.length > 0
  const d = ok ? payload![0]?.payload : null
  const pct = d && total > 0 ? (d.value / total) * 100 : 0
  return (
    <TooltipPortal active={ok && !!d}>
      {d && (
        <div className="tooltip">
          <div className="tt-title">v{d.name}</div>
          <div className="tt-row"><span>Value</span><span className="tt-val">{fmt(d.value)}</span></div>
          <div className="tt-row"><span>Share</span><span className="tt-val">{pct.toFixed(1)}%</span></div>
        </div>
      )}
    </TooltipPortal>
  )
}
