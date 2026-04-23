import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  format, addDays, addMonths, subMonths,
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameDay, isSameMonth, isToday,
} from 'date-fns'
import { useDateLocale } from '../lib/format'

/** Compact date picker — trigger button shows the current value, the
 *  popover is fixed-positioned (escapes overflow:hidden ancestors and
 *  stays anchored on scroll-jank). Closes on outside click / Esc /
 *  resize / scroll so it never lingers in the wrong place. */
export function DateField({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  const dl = useDateLocale()
  const weekStartsOn = (dl.options?.weekStartsOn ?? 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(value))
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    setViewMonth(startOfMonth(value))
  }, [open, value])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const margin = 8
    const width = 280
    let left = r.left
    if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width
    if (left < margin) left = margin
    let top = r.bottom + 6
    const estH = 280
    if (top + estH > window.innerHeight - margin) top = Math.max(margin, r.top - estH - 6)
    setPos({ left, top })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node
      if (triggerRef.current?.contains(n)) return
      if (popoverRef.current?.contains(n)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onScroll = () => setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn })
  const gridEnd = endOfWeek(endOfMonth(viewMonth), { weekStartsOn })
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })
  const weekdays = Array.from({ length: 7 }, (_, i) => format(addDays(gridStart, i), 'EEEEEE', { locale: dl }))

  return (
    <>
      <button
        ref={triggerRef}
        className="date-field"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {format(value, 'PP', { locale: dl })}
      </button>
      {open && pos && (
        <div
          ref={popoverRef}
          className="date-popover"
          role="dialog"
          aria-modal="false"
          style={{ position: 'fixed', left: pos.left, top: pos.top }}
        >
          <div className="date-nav">
            <button className="date-nav-btn" onClick={() => setViewMonth(subMonths(viewMonth, 1))} aria-label="prev">‹</button>
            <span className="date-nav-title">{format(viewMonth, 'LLLL yyyy', { locale: dl })}</span>
            <button className="date-nav-btn" onClick={() => setViewMonth(addMonths(viewMonth, 1))} aria-label="next">›</button>
          </div>
          <div className="date-weekdays">
            {weekdays.map((w, i) => <span key={i} className="date-weekday">{w}</span>)}
          </div>
          <div className="date-grid">
            {days.map(d => {
              const other = !isSameMonth(d, viewMonth)
              const sel = isSameDay(d, value)
              const today = isToday(d)
              return (
                <button
                  key={d.getTime()}
                  type="button"
                  className={`date-day${other ? ' other' : ''}${sel ? ' selected' : ''}${today ? ' today' : ''}`}
                  onClick={() => { onChange(d); setOpen(false) }}
                >
                  {format(d, 'd', { locale: dl })}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
