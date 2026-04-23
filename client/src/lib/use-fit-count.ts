import { useLayoutEffect, useState } from 'react'

/** How many leading children of `containerRef` fit inside its visible
 *  height. Re-runs on container resize. The container is expected to
 *  render `totalRows` children initially; the hook measures the first
 *  child's height and the available space, and returns a count.
 *
 *  When the result is < totalRows, callers should render an "+N more"
 *  affordance. Pass its DOM ref as `footerRef` so the hook subtracts
 *  the footer's *actual* rendered height — important for footers that
 *  wrap to two lines on narrow widgets / long localizations.
 *  `reserveBottom` is a fallback when the footer hasn't mounted yet.
 *
 *  `rowSelector` lets table-shaped containers (with thead/tbody) point
 *  at the actual row nodes; defaults to direct children. */
export function useFitCount(
  containerRef: React.RefObject<HTMLElement | null>,
  totalRows: number,
  opts: {
    reserveBottom?: number
    rowSelector?: string
    footerRef?: React.RefObject<HTMLElement | null>
  } = {}
): number {
  const [count, setCount] = useState(totalRows)
  const reserve = opts.reserveBottom ?? 0
  const sel = opts.rowSelector
  const footerRef = opts.footerRef

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || totalRows === 0) { setCount(totalRows); return }

    const measure = () => {
      const rows = sel
        ? Array.from(el.querySelectorAll<HTMLElement>(sel))
        : Array.from(el.children) as HTMLElement[]
      const first = rows[0]
      // No rows currently rendered — can happen if a previous measure
      // dropped count to 0 and ResizeObserver fired before recovery.
      // Bootstrap by rendering at least one row so the next paint gives
      // us something to measure.
      if (!first) { setCount(c => Math.max(1, c)); return }
      // Row pitch = distance between consecutive row tops; this folds in
      // any gap/margin between rows. Falls back to row height when only
      // one row is currently rendered.
      const rowH = rows.length > 1
        ? Math.max(1, rows[1].offsetTop - rows[0].offsetTop)
        : first.offsetHeight
      if (rowH <= 0) return
      const topOffset = first.offsetTop
      const avail = el.clientHeight - topOffset
      // Container hasn't been laid out yet (e.g. GridStack assigns size
      // asynchronously after mount). Don't lock to 0 — wait for the next
      // ResizeObserver fire, keeping current count so rows stay rendered.
      if (avail <= 0) return
      // Add one row's worth of pitch back when checking "all fit": the
      // last row needs only its content height, not a trailing gap.
      const fitNoChip = Math.floor((avail + (rowH - first.offsetHeight)) / rowH)
      if (fitNoChip >= totalRows) { setCount(totalRows); return }
      // Use the footer's real rendered height when available — handles
      // i18n strings that wrap to 2+ lines on narrow tiles.
      const footerH = footerRef?.current?.offsetHeight ?? reserve
      const fitWithChip = Math.max(1, Math.floor((avail - footerH) / rowH))
      setCount(Math.min(fitWithChip, totalRows))
    }

    const bodyRO = new ResizeObserver(measure)
    bodyRO.observe(el)

    // Footer ref is null on first mount (WidgetListMore returns null
    // when nothing is hidden). We can't observe it directly in this
    // effect — instead, watch the body for child mutations and (re)
    // attach a ResizeObserver to the footer whenever it appears or
    // changes. This catches both: footer mounting after the first
    // measure drops count below totalRows, AND footer wrapping to 2+
    // lines on narrow widgets where its own size changes.
    let footerRO: ResizeObserver | null = null
    let observed: HTMLElement | null = null
    const reattachFooter = () => {
      const f = footerRef?.current ?? null
      if (f === observed) return
      footerRO?.disconnect()
      observed = f
      if (f) {
        footerRO = new ResizeObserver(measure)
        footerRO.observe(f)
      } else {
        footerRO = null
      }
    }
    const mo = new MutationObserver(() => { reattachFooter(); measure() })
    mo.observe(el, { childList: true, subtree: true })

    reattachFooter()
    measure()

    return () => { bodyRO.disconnect(); footerRO?.disconnect(); mo.disconnect() }
  }, [containerRef, totalRows, reserve, sel, footerRef])

  return count
}
