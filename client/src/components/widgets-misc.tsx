/** Small reusable components used across screens / widgets:
 *  - Date primitives (DateCell, DateText)
 *  - Text utilities (HighlightedText, MidEllipsis)
 *  - UI bits (HelpTip, ChartEmpty, PanelHeader, WidgetListMore)
 *  - KPI building blocks (KpiGroup, KpiMetric, FlagStat) */

import type React from 'react'
import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useT } from '../i18n'
import { useDateLocale, useFmtDateCompact, fmtInt } from '../lib/format'

// ─── Date primitives ──────────────────────────────────────────────────

export function DateCell({ value, fallback = '—' }: { value: string | null | undefined; fallback?: string }) {
  const fmt = useFmtDateCompact()
  if (!value) return <span className="date-cell date-cell--empty">{fallback}</span>
  return <span className="date-cell" title={value}>{fmt(value)}</span>
}

export function DateText({ value, fallback = '—' }: { value: string | null | undefined; fallback?: string }) {
  const dl = useDateLocale()
  if (!value) return <span className="date-text date-text--empty">{fallback}</span>
  return <span className="date-text" title={value}>{format(parseISO(value), 'd MMM yyyy', { locale: dl })}</span>
}

// ─── Truncation indicator for fit-to-height lists ────────────────────

/** Footer shown by list/table widgets when not all rows fit in the
 *  current tile height. Pairs the count ("Showing X of Y") with a hint
 *  that resizing the widget reveals more. The forwarded ref lets the
 *  parent's useFitCount measure the footer's *real* height (important
 *  when the localized hint wraps to two lines on narrow tiles). */
export const WidgetListMore = forwardRef<HTMLDivElement, { shown: number; total: number }>(
  function WidgetListMore({ shown, total }, ref) {
    const t = useT()
    if (total <= 0) return null
    const hidden = total - shown
    const text = hidden > 0
      ? t('widget.listMore.compactFmt', { shown, total, hidden })
      : t('widget.listMore.allFmt', { total })
    return (
      <div
        ref={ref}
        className={`widget-list-more${hidden > 0 ? '' : ' is-complete'}`}
        title={hidden > 0 ? t('widget.listMore.tipFmt', { hidden }) : ''}
      >
        <span className="widget-list-more-count">{text}</span>
      </div>
    )
  }
)

// ─── Highlighted text + middle-ellipsis ──────────────────────────────

/** Highlight matched substring of `query` inside `text` with <mark>. Case-insensitive. */
export function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const q = query.toLowerCase()
  const lower = text.toLowerCase()
  const parts: React.ReactNode[] = []
  let i = 0
  let n = 0
  while (i < text.length) {
    const idx = lower.indexOf(q, i)
    if (idx === -1) {
      parts.push(text.slice(i))
      break
    }
    if (idx > i) parts.push(text.slice(i, idx))
    parts.push(<mark key={n++} className="search-hit">{text.slice(idx, idx + q.length)}</mark>)
    i = idx + q.length
  }
  return <>{parts}</>
}

/** Middle-ellipsis text component. Truncates with `…` in the middle so both
 *  the start (e.g. `~/Desktop/`) and the end (e.g. `/telemetry/claude_stats`)
 *  stay visible — the end is usually the meaningful identifier for paths.
 *  When `query` is active, falls back to full text + <mark> highlighting so
 *  the match position remains visible (truncation would hide the match). */
export function MidEllipsis({ text, query, className }: { text: string; query?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [display, setDisplay] = useState(text)
  const isHighlighting = !!query

  useLayoutEffect(() => {
    if (isHighlighting) { setDisplay(text); return }
    const el = ref.current
    const parent = el?.parentElement
    if (!el || !parent) return

    const sharedCanvas = (MidEllipsis as unknown as { _c?: HTMLCanvasElement })._c
      || ((MidEllipsis as unknown as { _c?: HTMLCanvasElement })._c = document.createElement('canvas'))
    const ctx = sharedCanvas.getContext('2d')!

    const compute = () => {
      const containerW = parent.clientWidth
      if (containerW <= 0) return
      const cs = getComputedStyle(el)
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      const SLACK = 4
      if (ctx.measureText(text).width <= containerW + SLACK) {
        setDisplay(text)
        return
      }
      const ELLIPSIS = '…'
      let lo = 0, hi = text.length - 1
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        const startN = Math.ceil(mid / 2)
        const endN = mid - startN
        const candidate = text.slice(0, startN) + ELLIPSIS + (endN > 0 ? text.slice(text.length - endN) : '')
        if (ctx.measureText(candidate).width <= containerW) lo = mid
        else hi = mid - 1
      }
      const startN = Math.ceil(lo / 2)
      const endN = lo - startN
      setDisplay(text.slice(0, startN) + ELLIPSIS + (endN > 0 ? text.slice(text.length - endN) : ''))
    }

    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(parent)
    return () => ro.disconnect()
  }, [text, isHighlighting])

  if (isHighlighting) return <span className={className}><HighlightedText text={text} query={query!} /></span>
  return <span ref={ref} className={className} title={text !== display ? text : undefined}>{display}</span>
}

// ─── ChartEmpty + PanelHeader ────────────────────────────────────────

export function ChartEmpty({ height = 260, hint }: { height?: number; hint?: string }) {
  const t = useT()
  return (
    <div className="chart-empty" style={{ height }}>
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <circle cx="16" cy="16" r="11" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 3" opacity="0.6" />
        <path d="M 9 16 L 23 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />
      </svg>
      <div className="chart-empty-title">{t('common.emptyChart')}</div>
      <div className="chart-empty-hint">{hint ?? t('common.emptyChartHint')}</div>
    </div>
  )
}

export function PanelHeader({ title, sub, help }: { title: string; sub?: string; help?: React.ReactNode }) {
  return (
    <div className="panel-head">
      <div>
        <div className="panel-title-row">
          <h3 style={{ margin: 0 }}>{title}</h3>
          {help && <HelpTip>{help}</HelpTip>}
        </div>
        {sub && <span className="panel-sub">{sub}</span>}
      </div>
    </div>
  )
}

// ─── HelpTip: floating tooltip with hover/touch handling ─────────────

const canHover = typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches

export function HelpTip({ children }: { children: React.ReactNode }) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const margin = 8
    const trigger = triggerRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const desiredW = Math.min(280, vw - margin * 2)
    let left = trigger.left + trigger.width / 2 - desiredW / 2
    if (left < margin) left = margin
    if (left + desiredW > vw - margin) left = vw - margin - desiredW
    let top = trigger.bottom + 8
    const estimatedH = bubbleRef.current?.offsetHeight ?? 120
    if (top + estimatedH > vh - margin) {
      top = Math.max(margin, trigger.top - estimatedH - 8)
    }
    setPos({ left, top, width: desiredW })
  }, [open])

  useEffect(() => {
    if (!open) return
    const closeOnScrollResize = () => setOpen(false)
    window.addEventListener('scroll', closeOnScrollResize, true)
    window.addEventListener('resize', closeOnScrollResize)
    let onPointerDown: ((e: PointerEvent) => void) | null = null
    if (!canHover) {
      onPointerDown = (e) => {
        if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) setOpen(false)
      }
      document.addEventListener('pointerdown', onPointerDown)
    }
    return () => {
      window.removeEventListener('scroll', closeOnScrollResize, true)
      window.removeEventListener('resize', closeOnScrollResize)
      if (onPointerDown) document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  const hoverProps = canHover ? {
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
  } : {
    onClick: (e: React.MouseEvent) => { e.stopPropagation(); setOpen(o => !o) },
  }

  return (
    <>
      <span
        ref={triggerRef}
        className="help-tip"
        tabIndex={0}
        aria-label="Help"
        aria-expanded={open}
        {...hoverProps}
      >?</span>
      {open && pos && (
        <div
          ref={bubbleRef}
          role="tooltip"
          className="help-bubble-floating"
          style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width }}
        >
          {children}
        </div>
      )}
    </>
  )
}

// ─── KPI building blocks + FlagStat ──────────────────────────────────

export function KpiGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="kpi-group">
      <div className="kpi-group-title">{title}</div>
      <div className="kpi-group-body">{children}</div>
    </div>
  )
}

export function KpiMetric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi-metric">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

export function FlagStat({ label, value, total }: { label: string; value: number; total: number }) {
  const t = useT()
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div className="flag-stat">
      <div className="flag-label">{label}</div>
      <div className="flag-value">{fmtInt(value)}</div>
      <div className="flag-sub">{t('insights.flags.subFmt', { pct: pct.toFixed(1), total: fmtInt(total) })}</div>
    </div>
  )
}
