/**
 * Widget grid system — generic, screen-agnostic.
 *
 * Powered by GridStack.js — a dashboard-specific library built for exactly
 * this use case (drag, resize, swap, empty-row collapse, responsive). Way
 * more polished than react-grid-layout for professional dashboard UX.
 *
 * Public API is identical to the previous react-grid-layout version so
 * consumers (App.tsx widget catalogs) don't need to change.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { GridStack, type GridStackWidget } from 'gridstack'
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query'
import { useT } from '../i18n'
import { apiGet, apiPut, apiDelete } from '../api'
import 'gridstack/dist/gridstack.css'

// ─── Types (public) ────────────────────────────────────────────────────

export type WidgetSize = { w: number; h: number; label?: string }
export type WidgetCategory = 'kpi' | 'chart' | 'table' | 'insights'

/** Top-level picker grouping. Purely cosmetic — "category" drives
 *  default-sizes, "section" drives picker headers. Keep in sync with
 *  SECTION_LABELS and SECTION_ORDER below. */
export type WidgetSection = 'general' | 'insights' | 'agents'

/** Context passed to a widget's render function — includes current tile
 *  dimensions in grid units, so widgets can adapt their content (drop
 *  legends at small heights, show fewer rows in tables, etc.). Updates
 *  on any layout change persisted to the server (debounce ~no debounce). */
export type WidgetDef = {
  id: string
  title: string
  description?: string
  category?: WidgetCategory
  /** Picker grouping — shown as a section header. Defaults to 'general'. */
  section?: WidgetSection
  /** Supported sizes in the picker. First entry is the default. If omitted,
   *  the picker falls back to a sensible default based on `category`. */
  sizes?: WidgetSize[]
  minW?: number
  minH?: number
  render: (ctx: { editing: boolean; w: number; h: number }) => React.ReactNode
}

export type Placed = {
  i: string
  x: number; y: number
  w: number; h: number
  minW?: number; minH?: number
}

export type ScreenLayout = {
  widgets: Placed[]
  hidden: string[]
}

// ─── Grid config ───────────────────────────────────────────────────────

const COLS = 4
// One row = one widget UNIT. With CELL_HEIGHT=132 and MARGIN=12, the
// resize step is exactly one unit — users can't accidentally drag a
// widget into a half-unit size that breaks alignment with neighbours.
//   h=1 = 132px (compact KPI)
//   h=2 = 132+12+132 = 276px (chart, = 2 KPIs stacked)
//   h=3 = 3*132 + 2*12 = 420px (tall chart, = 3 KPIs stacked)
const CELL_HEIGHT = 132
const MARGIN = 12
const MOBILE_BREAKPOINT = 720

// Default sizes per category used by the picker when a WidgetDef has no
// explicit `sizes` array. Keep in sync with widget files that do set sizes.
const DEFAULT_SIZES_BY_CATEGORY: Record<WidgetCategory, WidgetSize[]> = {
  kpi: [{ w: 1, h: 1 }, { w: 2, h: 1 }],
  chart: [{ w: 2, h: 2 }, { w: 4, h: 2 }, { w: 2, h: 3 }],
  table: [{ w: 2, h: 3 }, { w: 4, h: 3 }, { w: 2, h: 4 }],
  insights: [{ w: 2, h: 3 }, { w: 4, h: 3 }],
}

function sizesFor(def: WidgetDef): WidgetSize[] {
  if (def.sizes && def.sizes.length > 0) return def.sizes
  if (def.category) return DEFAULT_SIZES_BY_CATEGORY[def.category]
  return [{ w: 2, h: 2 }]
}

// ─── Hook: fetch + mutate the layout ───────────────────────────────────

export function useScreenLayout(screen: string) {
  const qc = useQueryClient()
  const query = useQuery<ScreenLayout>({
    queryKey: ['layout', screen],
    queryFn: () => apiGet<ScreenLayout>(`/api/layout/${screen}`),
    placeholderData: keepPreviousData,
  })
  const save = useMutation({
    mutationFn: (layout: ScreenLayout) =>
      apiPut<ScreenLayout>(`/api/layout/${screen}`, layout),
    onMutate: async (next) => {
      qc.setQueryData(['layout', screen], next)
    },
  })
  const reset = useMutation({
    mutationFn: () => apiDelete<ScreenLayout>(`/api/layout/${screen}`),
    onSuccess: (fresh) => {
      qc.setQueryData(['layout', screen], fresh)
    },
  })
  return { query, save, reset }
}

// ─── Layout sanitization ──────────────────────────────────────────────

/** Remove fully-empty rows ONLY (rows where no widget covers any
 *  column). Widgets keep their relative x positions and shift y up by
 *  the number of empty rows above them. Stricter than GridStack's
 *  built-in compact which also packs columns vertically — we want
 *  user-placed positions preserved. */
export function compactEmptyRows(widgets: Placed[]): Placed[] {
  if (widgets.length === 0) return widgets
  const maxY = Math.max(...widgets.map(w => w.y + w.h))
  const occupied = new Array(maxY).fill(false)
  for (const w of widgets) {
    for (let y = w.y; y < w.y + w.h; y++) occupied[y] = true
  }
  const shift = new Array(maxY + 1).fill(0)
  let unoccupied = 0
  for (let y = 0; y < maxY; y++) {
    shift[y] = unoccupied
    if (!occupied[y]) unoccupied++
  }
  if (unoccupied === 0) return widgets
  return widgets.map(w => ({ ...w, y: w.y - shift[w.y] }))
}

function reconcile(layout: ScreenLayout, catalog: WidgetDef[]): ScreenLayout {
  const ids = new Set(catalog.map(w => w.id))
  const widgets = layout.widgets.filter(w => ids.has(w.i))
  const placedIds = new Set(widgets.map(w => w.i))
  const hidden = layout.hidden.filter(id => ids.has(id) && !placedIds.has(id))
  for (const w of catalog) {
    if (!placedIds.has(w.id) && !hidden.includes(w.id)) hidden.push(w.id)
  }
  return { widgets, hidden }
}

// ─── Empty-slot detection ─────────────────────────────────────────────

type EmptySlot = {
  x: number; y: number; w: number; h: number
  /** Marks the trailing bottom-row slot. Visually it stays h=1 (one
   *  cell tall, just an "add here" target) but the picker treats it
   *  as height-unbounded — anything in the catalog can be dropped at
   *  the bottom regardless of its natural h. */
  bottomless?: boolean
}

// Prefix used to identify placeholder (empty-slot) GridStack items in
// serialized output. Real widget ids never start with this, so filtering
// on it in handleChange cleanly separates saved layout from placeholders.
const SLOT_ID_PREFIX = '__slot_'

/** Find horizontal empty runs in the grid, optionally extending up to 2
 *  rows tall when the rows below are also free for the same columns. Also
 *  always emits a bottom row at y=maxY spanning all columns. */
function findEmptySlots(widgets: Placed[]): EmptySlot[] {
  const maxY = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0)
  const slots: EmptySlot[] = []
  // Row-occupancy: occ[y][x] = true if occupied.
  const occ: boolean[][] = Array.from({ length: maxY + 1 }, () => new Array(COLS).fill(false))
  for (const w of widgets) {
    for (let y = w.y; y < w.y + w.h; y++) {
      for (let x = w.x; x < w.x + w.w; x++) {
        if (y < occ.length && x < COLS) occ[y][x] = true
      }
    }
  }
  // Track which cells we've already emitted, so tall slots don't get
  // duplicated as a 1-tall slot on the second row.
  const emitted: boolean[][] = Array.from({ length: maxY + 1 }, () => new Array(COLS).fill(false))

  for (let y = 0; y < maxY; y++) {
    let x = 0
    while (x < COLS) {
      if (occ[y][x] || emitted[y][x]) { x++; continue }
      // Extend run horizontally while free and not already emitted.
      let runEnd = x
      while (runEnd < COLS && !occ[y][runEnd] && !emitted[y][runEnd]) runEnd++
      const runW = runEnd - x
      // How tall can this slot be? Up to 2 rows, columns [x, runEnd) all free.
      let h = 1
      if (y + 1 < maxY) {
        let canExtend = true
        for (let cx = x; cx < runEnd; cx++) {
          if (occ[y + 1][cx] || emitted[y + 1][cx]) { canExtend = false; break }
        }
        if (canExtend) h = 2
      }
      slots.push({ x, y, w: runW, h })
      for (let dy = 0; dy < h; dy++) {
        for (let cx = x; cx < runEnd; cx++) emitted[y + dy][cx] = true
      }
      x = runEnd
    }
  }
  // Always emit bottom row spanning all columns. Marked bottomless so
  // the picker accepts widgets of any height (nothing is below to
  // collide with) — without this, the bottom "+" only accepted h=1
  // widgets, hiding everything else from the catalog.
  slots.push({ x: 0, y: maxY, w: COLS, h: 1, bottomless: true })
  return slots
}

// ─── <WidgetGrid> ─────────────────────────────────────────────────────

type WidgetGridProps = {
  screen: string
  catalog: WidgetDef[]
  editing: boolean
  /** Called after a drag/resize that produced fully-empty rows. Parent
   *  bumps the layoutEpoch which remounts this WidgetGrid — GridStack
   *  re-initializes from the freshly-compacted layout. Cleaner than
   *  trying to update GridStack in place (which broke resize bindings). */
  onLayoutSettled?: () => void
  /** Optional: when editing, clicking an empty-slot placeholder invokes
   *  this with the slot's (x, y, maxW, maxH). The parent (dashboard.tsx)
   *  uses it to open the side-panel picker pre-targeted to that slot. */
  onSlotPick?: (slot: { x: number; y: number; maxW: number; maxH: number; insertMode?: 'gap' | 'row-break'; bottomless?: boolean }) => void
}

export function WidgetGrid({ screen, catalog, editing, onLayoutSettled, onSlotPick }: WidgetGridProps) {
  const t = useT()
  const { query, save } = useScreenLayout(screen)
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT
  )

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const layout = useMemo(() => {
    if (!query.data) return null
    return reconcile(query.data, catalog)
  }, [query.data, catalog])

  const catalogById = useMemo(
    () => new Map(catalog.map(w => [w.id, w])),
    [catalog]
  )

  const containerRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<GridStack | null>(null)
  // Keep a fresh ref to onLayoutSettled — the GridStack init effect runs
  // once, so its closure would otherwise hold the first-render callback.
  const onLayoutSettledRef = useRef(onLayoutSettled)
  useEffect(() => { onLayoutSettledRef.current = onLayoutSettled }, [onLayoutSettled])

  // Initialize GridStack once when layout first arrives. DnD is always
  // "wired" here — we toggle it on/off via enable()/disable() in the
  // separate edit-mode effect below. Using setStatic() instead
  // permanently rips out DnD handlers and they don't reliably come back,
  // so stick with enable/disable for the toggle.
  useLayoutEffect(() => {
    if (!containerRef.current || !layout || gridRef.current) return
    if (isMobile) return

    const grid = GridStack.init({
      column: COLS,
      cellHeight: CELL_HEIGHT,
      margin: MARGIN,
      // float: true — widgets stay exactly where dropped. Per-column
      // vertical compaction (the default) is confusing: drag one widget
      // out of a vertical stack and its neighbours below "slide up"
      // unexpectedly. People reason about layouts in rows, not columns,
      // so stability matters more than tightness. Empty rows can be
      // tidied manually by dragging widgets together.
      float: true,
      animate: true,
      // Drag the whole widget — more natural than restricting to a handle.
      // Clicks on interactive elements (remove button, links, etc.) are
      // exempted via `cancel`, and edit mode also covers the body with a
      // pointer-events:none layer so internal links don't fire during edit.
      draggable: { cancel: 'button, a, input, .widget-tile-remove' },
      acceptWidgets: false,
      removable: false,
    }, containerRef.current)

    // Start disabled if we're not in edit mode yet.
    if (!editing) grid.disable()

    const handleChange = () => {
      const snap = grid.save(false) as GridStackWidget[]
      // Filter out empty-slot placeholder items — those are layout scaffolding
      // injected by this component in edit mode, NOT real widgets. Matching
      // on gs-id prefix keeps the filter simple and unambiguous.
      const current: Placed[] = snap
        .filter(w => !String(w.id).startsWith(SLOT_ID_PREFIX))
        .map(w => ({
          i: String(w.id),
          x: w.x ?? 0,
          y: w.y ?? 0,
          w: w.w ?? 1,
          h: w.h ?? 1,
          minW: w.minW,
          minH: w.minH,
        }))
      // CORRUPTION GUARD: if the engine snapshot has fewer real widgets
      // than what React intends to render (layout.widgets), the engine
      // must still be catching up with async-loaded widgets (e.g.
      // insights). Saving NOW would overwrite the server layout with a
      // partial set — we'd silently drop the widgets GridStack hadn't
      // registered yet. Bail out; we'll re-save when a genuine user drag/
      // resize fires `change` after the engine is fully populated. This
      // was the root cause of "different projects show fewer widgets" —
      // the catch-up `makeWidget` calls in the sync effect fire `added`
      // events which reach this handler before the engine has all tiles.
      const expectedCount = layout.widgets.length
      if (current.length < expectedCount) return
      // Tighten: remove fully-empty rows. Stricter than grid.compact()
      // which also packs columns vertically.
      const compacted = compactEmptyRows(current)
      const hasEmptyRows = compacted.some((w, i) => w.y !== current[i].y)
      const next: ScreenLayout = {
        widgets: hasEmptyRows ? compacted : current,
        hidden: layout.hidden,
      }
      save.mutate(next)
      // If we tightened the layout, ask the parent to remount this
      // WidgetGrid via layoutEpoch bump. GridStack re-initializes
      // from the new compacted layout cleanly — applying it in-place
      // via grid.update() was breaking resize-handle bindings.
      if (hasEmptyRows) onLayoutSettledRef.current?.()
    }
    // After any drag/resize completes OR an item is added/removed, ask the
    // parent to remount. Placeholders (empty-slot .grid-stack-item children)
    // are rendered from the layout by React — when widgets move, the set of
    // placeholders changes and we need GridStack re-initialized so its
    // engine knows about the new placeholder set. Remounting on *stop*
    // events (not during the drag) keeps the interaction smooth.
    const handleSettled = () => {
      // `change` already ran via the grid.on('change') binding and saved;
      // here we just bump the layoutEpoch so the parent remounts.
      onLayoutSettledRef.current?.()
    }
    grid.on('change', handleChange)
    grid.on('added', handleChange)
    grid.on('removed', handleChange)
    grid.on('dragstop', handleSettled)
    grid.on('resizestop', handleSettled)

    gridRef.current = grid

    return () => {
      grid.destroy(false)
      gridRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, layout !== null])

  // Toggle DnD on existing GridStack instance (lightweight, reversible).
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    if (editing) grid.enable()
    else grid.disable()
  }, [editing])

  // Placeholder engine sync. Placeholders are purely visual — they must
  // NOT be in GridStack's collision engine, or dragging a real widget onto
  // a placeholder cell gets blocked. But they DO need correct positioning
  // (left/top/width/height) in the CSS grid. Strategy:
  //
  //   1) If GridStack picked the placeholder up at init time (carries
  //      .grid-stack-item with gs-x/y/w/h so init sweeps it into the
  //      engine + writes inline positioning styles), call
  //      removeWidget(el, false, false) — engine forgets it, DOM stays
  //      positioned via the inline styles already written.
  //
  //   2) If placeholders are added AFTER init (user flips editing on
  //      without remounting), GridStack doesn't observe new children on
  //      its own. Write the same calc()-based inline styles ourselves,
  //      matching what GridStack's _writePosAttr would have written, using
  //      the gs-x/y/w/h attributes on each placeholder. Skip the engine
  //      entirely.
  //
  // Runs on every commit — cheap, idempotent.
  useLayoutEffect(() => {
    const grid = gridRef.current
    const container = containerRef.current
    if (!grid || !container) return
    const els = container.querySelectorAll<HTMLElement>('.widget-slot-empty')
    els.forEach(el => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hasNode = !!(el as any).gridstackNode
      if (hasNode) {
        // Already in engine (picked up at init). Drop the engine node
        // silently; DOM + inline positioning styles stay.
        grid.removeWidget(el, false, false)
        return
      }
      // Added after init: position ourselves via the gs-* attrs.
      const x = Number(el.getAttribute('gs-x') ?? '0')
      const y = Number(el.getAttribute('gs-y') ?? '0')
      const w = Number(el.getAttribute('gs-w') ?? '1')
      const h = Number(el.getAttribute('gs-h') ?? '1')
      el.style.left = x ? `calc(${x} * var(--gs-column-width))` : ''
      el.style.top = y ? `calc(${y} * var(--gs-cell-height))` : ''
      el.style.width = w > 1 ? `calc(${w} * var(--gs-column-width))` : ''
      el.style.height = h > 1 ? `calc(${h} * var(--gs-cell-height))` : ''
    })
    // Real-widget sync: async-loaded widgets (insights fetch resolving after
    // init, adding more .grid-stack-item children) don't get picked up by
    // GridStack on their own. Register any orphan tile with the engine so it
    // reads gs-x/y/w/h and writes the correct inline positioning. Without
    // this they stack at (0,0) on top of the first KPI.
    container.querySelectorAll<HTMLElement>('.grid-stack-item:not(.widget-slot-empty)').forEach(el => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!(el as any).gridstackNode) grid.makeWidget(el)
    })
  })

  // (Compaction is handled at the App level: it computes compactEmptyRows,
  // saves to server, bumps layoutEpoch which remounts this component.
  // Doing it from inside via grid.update() was breaking resize-handle
  // bindings and grid.compact() does the wrong thing — packs columns.)

  // External-change sync (Reset/Cancel) is handled via a React `key`
  // at the parent — changing the key remounts the whole WidgetGrid and
  // re-initializes GridStack from the new layout. Simpler and more
  // reliable than trying to diff against GridStack's internal state.

  // ─── Mobile render: read-only single-column stack ──────────────────
  if (isMobile) {
    if (!layout) return <div className="widget-grid-loading" />
    const ordered = [...layout.widgets].sort((a, b) => a.y - b.y || a.x - b.x)
    return (
      <div className="widget-grid widget-grid-mobile">
        {ordered.map(p => {
          const def = catalogById.get(p.i)
          if (!def) return null
          return (
            <div key={p.i} className="widget-tile widget-tile-mobile">
              {def.render({ editing: false, w: p.w, h: p.h })}
            </div>
          )
        })}
      </div>
    )
  }

  if (!layout) return <div className="widget-grid-loading" />

  const removeWidget = (id: string) => {
    // Compute the new layout ourselves (filter + compact empty rows) and
    // save it. Then bump layoutEpoch via onLayoutSettled — the parent
    // remounts this WidgetGrid and GridStack re-initializes from the
    // fresh layout. Calling grid.removeWidget() here would also fire a
    // 'removed' event that races with our save below.
    const remaining = layout.widgets.filter(w => w.i !== id)
    const compacted = compactEmptyRows(remaining)
    const next: ScreenLayout = {
      widgets: compacted,
      hidden: layout.hidden.includes(id) ? layout.hidden : [...layout.hidden, id],
    }
    save.mutate(next)
    onLayoutSettledRef.current?.()
  }

  // When the catalog is fully placed (`hidden` empty), the picker has
  // nothing to offer — so we hide the "+" affordances. But the slot
  // rectangles themselves stay visible: they're the user's visual map of
  // where widgets could go, which is a critical part of the drag-drop
  // feedback loop.
  const hasAddable = layout.hidden.length > 0
  const slots = editing ? findEmptySlots(layout.widgets) : []

  return (
    <div
      ref={containerRef}
      className={`grid-stack widget-grid${editing ? ' is-editing' : ''}`}
    >
      {layout.widgets.map(p => {
        const def = catalogById.get(p.i)
        if (!def) return null
        return (
          <div
            key={p.i}
            className="grid-stack-item widget-tile"
            data-widget={p.i}
            gs-id={p.i}
            gs-x={String(p.x)}
            gs-y={String(p.y)}
            gs-w={String(p.w)}
            gs-h={String(p.h)}
            gs-min-w={p.minW !== undefined ? String(p.minW) : undefined}
            gs-min-h={p.minH !== undefined ? String(p.minH) : undefined}
          >
            <div className="grid-stack-item-content">
              <div className="widget-tile-body">{def.render({ editing, w: p.w, h: p.h })}</div>
              {editing && (
                <>
                  {onSlotPick && hasAddable && (
                    <button
                      className="widget-tile-insert-row-above"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        // Insert a full-width row AT this widget's y,
                        // shifting this widget (and everything below) down
                        // by the new widget's height. Reuses the picker's
                        // existing 'row-break' branch.
                        onSlotPick({ x: 0, y: p.y, maxW: COLS, maxH: 4, insertMode: 'row-break' })
                      }}
                      title={t('customize.insertRow')}
                      aria-label={t('customize.insertRow')}
                    >
                      <span className="widget-tile-insert-row-above-plus">↑+</span>
                    </button>
                  )}
                  <button
                    className="widget-tile-remove"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); removeWidget(p.i) }}
                    title={`Remove ${def.title}`}
                    aria-label={`Remove ${def.title}`}
                  >×</button>
                </>
              )}
            </div>
          </div>
        )
      })}
      {/* Empty-slot placeholders (edit mode). Rendered as .grid-stack-item
          children so GridStack picks them up at init time and assigns the
          correct inline CSS (left/top/width/height via --gs-column-width
          / --gs-cell-height vars) for their x/y/w/h cells. Immediately
          after init we call grid.removeWidget(el, false, false) on each
          one: the DOM node (and its positioning) stays, but the collision
          engine forgets they exist — real widgets can now be dragged INTO
          and resized THROUGH placeholder areas without being blocked. The
          parent remounts WidgetGrid on drag-stop / resize-stop (via
          onLayoutSettled) so placeholders recompute, GridStack re-inits,
          and we re-strip them. Deterministic gs-id based on coordinates
          keeps React keys stable across re-renders when slots match. */}
      {editing && onSlotPick && slots.map(s => {
        const slotId = `${SLOT_ID_PREFIX}${s.x}_${s.y}_${s.w}_${s.h}`
        return (
          <div
            key={slotId}
            className={`grid-stack-item widget-slot-empty${hasAddable ? '' : ' is-inert'}`}
            gs-id={slotId}
            gs-x={String(s.x)}
            gs-y={String(s.y)}
            gs-w={String(s.w)}
            gs-h={String(s.h)}
          >
            <div className="grid-stack-item-content widget-slot-empty-content">
              {hasAddable ? (
                <button
                  type="button"
                  className="widget-slot-empty-btn"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSlotPick({ x: s.x, y: s.y, maxW: s.w, maxH: s.h, insertMode: 'gap', bottomless: s.bottomless })
                  }}
                  aria-label="Add widget to empty slot"
                >
                  <span className="widget-slot-empty-plus">+</span>
                </button>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Add picker (side panel) ──────────────────────────────────────────

type AddPickerProps = {
  screen: string
  catalog: WidgetDef[]
  /** Controlled open state — panel is always driven by a parent, usually
   *  in response to a click on an empty-slot or row-break placeholder. */
  open: boolean
  onClose: () => void
  /** Target slot: the panel only shows widgets that fit and inserts at
   *  the slot's (x, y) with the chosen size. Required — no free-floating
   *  "add to bottom" mode anymore; that's covered by the bottom-row slot
   *  placeholder emitted by findEmptySlots. */
  slot: { x: number; y: number; maxW: number; maxH: number; insertMode?: 'gap' | 'row-break'; bottomless?: boolean }
  /** Called after a successful add so the parent can remount the WidgetGrid
   *  (bump layoutEpoch). Without this, GridStack engine stays pinned to the
   *  old DOM while React renders new widgets → visual overlap. */
  onAdded?: () => void
}

export function AddWidgetPicker({ screen, catalog, open, onClose, slot, onAdded }: AddPickerProps) {
  const t = useT()
  const { query, save } = useScreenLayout(screen)
  const close = () => onClose()

  const layout = useMemo(() => query.data ? reconcile(query.data, catalog) : null, [query.data, catalog])

  // Per-card selected size (map by widget id → index into sizesFor()).
  const [selected, setSelected] = useState<Record<string, number>>({})
  // Search filter for the picker — case-insensitive substring match on
  // widget title + description. Kicks in only when the catalog grows
  // past a handful of widgets (threshold in the render below).
  const [search, setSearch] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!layout) return null

  const available = layout.hidden
    .map(id => catalog.find(w => w.id === id))
    .filter((w): w is WidgetDef => !!w)

  // Filter by search query against title + description (case-insensitive).
  const q = search.trim().toLowerCase()
  const availableFiltered = q
    ? available.filter(w =>
        w.title.toLowerCase().includes(q) ||
        (w.description ?? '').toLowerCase().includes(q) ||
        w.id.toLowerCase().includes(q)
      )
    : available

  // Filter by slot constraints. For regular 'gap' slots: the size must
  // fit inside maxW × maxH. For 'row-break' slots: the size must span
  // all COLS (full-width). For the bottomless trailing slot: any
  // height is allowed (nothing below to collide with). minW/minH must
  // also be honored.
  const isRowBreak = slot.insertMode === 'row-break'
  const effectiveMaxH = slot.bottomless ? Infinity : slot.maxH
  const fitsSlot = (def: WidgetDef, size: WidgetSize): boolean => {
    const minW = def.minW ?? 1
    const minH = def.minH ?? 1
    if (size.w < minW || size.h < minH) return false
    if (isRowBreak) return size.w <= COLS && size.h <= effectiveMaxH
    return size.w <= slot.maxW && size.h <= effectiveMaxH
  }

  const fittingSizesFor = (def: WidgetDef): WidgetSize[] => {
    return sizesFor(def).filter(s => fitsSlot(def, s))
  }

  // Show non-fitting widgets (disabled) for discoverability. Fitting
  // widgets sort first. Also attach `section` (default 'general') so
  // the picker can render group headers.
  type WithFit = { def: WidgetDef; fitsSlot: boolean; section: WidgetSection }
  const visibleWidgets: WithFit[] = availableFiltered
    .map(def => ({
      def,
      fitsSlot: fittingSizesFor(def).length > 0,
      section: (def.section ?? 'general') as WidgetSection,
    }))
    .sort((a, b) => Number(b.fitsSlot) - Number(a.fitsSlot))

  // Group into sections, preserving the fitting-first order within
  // each group. SECTION_ORDER controls the display sequence; unknown
  // sections (shouldn't happen) fall to the end under 'general'.
  const SECTION_ORDER: WidgetSection[] = ['general', 'insights', 'agents']
  const SECTION_LABELS: Record<WidgetSection, string> = {
    general: t('customize.sectionGeneral'),
    insights: t('customize.sectionInsights'),
    agents: t('customize.sectionAgents'),
  }
  const groupedWidgets: Array<{ section: WidgetSection; items: WithFit[] }> =
    SECTION_ORDER
      .map(s => ({ section: s, items: visibleWidgets.filter(w => w.section === s) }))
      .filter(g => g.items.length > 0)
  // Section headers render when the OVERALL catalog has more than one
  // section — not just the current filter result. Otherwise the
  // grouping disappears on narrow searches and users lose context.
  const overallSectionsCount = new Set(
    available.map(d => (d.section ?? 'general') as WidgetSection)
  ).size
  const showSectionHeaders = overallSectionsCount > 1

  const getSelectedSize = (def: WidgetDef): WidgetSize => {
    const sizes = fittingSizesFor(def)
    if (sizes.length === 0) return sizesFor(def)[0]
    const idx = selected[def.id]
    if (idx !== undefined && idx < sizes.length) return sizes[idx]
    // Default: preselect the LARGEST fitting size.
    let best = 0
    let bestArea = 0
    sizes.forEach((s, i) => { const a = s.w * s.h; if (a > bestArea) { bestArea = a; best = i } })
    return sizes[best]
  }

  const add = (def: WidgetDef) => {
    const size = getSelectedSize(def)
    let existing = layout.widgets
    let placed: Placed
    if (isRowBreak) {
      // Shift every widget at or below the break down by the new widget's
      // height so the full-width insertion lands at `slot.y` without overlap.
      existing = layout.widgets.map(w =>
        w.y >= slot.y ? { ...w, y: w.y + size.h } : w
      )
      placed = { i: def.id, x: 0, y: slot.y, w: size.w, h: size.h, minW: def.minW, minH: def.minH }
    } else {
      // Gap slot (including the bottom-row slot at y = maxY): place at the
      // slot's (x, y). The slot is guaranteed empty by construction, so no
      // shifting is needed. compactEmptyRows is a harmless no-op here —
      // gap slots never leave empty rows behind.
      placed = { i: def.id, x: slot.x, y: slot.y, w: size.w, h: size.h, minW: def.minW, minH: def.minH }
    }
    const compacted = compactEmptyRows([...existing, placed])
    save.mutate({
      widgets: compacted,
      hidden: layout.hidden.filter(h => h !== def.id),
    })
    // Force a remount of WidgetGrid so GridStack re-initializes from the
    // new React-rendered DOM. Without this, the engine still "sees" the old
    // item set (and their reserved cells), causing the new widget to be
    // placed on top of existing items.
    onAdded?.()
    close()
  }

  if (!open) return null

  return (
    <>
      <div className="widget-picker-backdrop" onClick={close} />
      <div
        className="widget-picker-panel"
        ref={panelRef}
        role="dialog"
        aria-label={t('customize.add')}
      >
        <div className="widget-picker-header">
          <h3>{t('customize.add')}</h3>
          <button
            className="widget-picker-close"
            onClick={close}
            aria-label={t('customize.pickerClose')}
          >×</button>
        </div>
        <div className="widget-picker-slot-hint">
          {t('customize.pickerSlotHintFmt', {
            row: String(slot.y + 1),
            colStart: String(slot.x + 1),
            colEnd: String(slot.x + slot.maxW),
          })}
          {isRowBreak && (
            <div className="widget-picker-slot-hint-rowbreak">
              {t('customize.pickerRowBreakHint')}
            </div>
          )}
        </div>
        <div className="widget-picker-search">
          <input
            type="search"
            placeholder={
              available.length > 0
                ? t('customize.searchPlaceholder', {
                    n: available.length,
                    widgets: available.length === 1
                      ? t('customize.widgetOne')
                      : t('customize.widgetMany'),
                  })
                : t('customize.searchDisabled')
            }
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label={t('customize.searchPlaceholder', {
              n: available.length,
              widgets: available.length === 1
                ? t('customize.widgetOne')
                : t('customize.widgetMany'),
            })}
            disabled={available.length === 0}
          />
        </div>
        <div className="widget-picker-list">
          {visibleWidgets.length === 0 ? (
            <div className="widget-picker-empty">
              {q
                ? <>
                    {t('customize.noMatch', { q })}{' '}
                    <button className="ghost" onClick={() => setSearch('')} style={{ textDecoration: 'underline', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)' }}>
                      {t('customize.clearSearch')}
                    </button>
                  </>
                : t('customize.addEmpty')}
            </div>
          ) : groupedWidgets.flatMap(group => [
            // Only show the section header when there is more than one
            // section — avoids a pointless "General" header on screens
            // that have no other sections available.
            showSectionHeaders ? (
              <div
                key={`__section_${group.section}`}
                className="widget-picker-section-header"
              >
                {SECTION_LABELS[group.section]}
              </div>
            ) : null,
            ...group.items.map(({ def, fitsSlot: doesFit }) => {
            // For disabled cards, preview the widget's default size so the
            // user can see WHY it doesn't fit (too tall/wide). For fitting
            // cards, preview whichever fitting size is currently selected.
            const sizes = doesFit ? fittingSizesFor(def) : sizesFor(def)
            const current = doesFit ? getSelectedSize(def) : sizesFor(def)[0]
            // Mini-grid preview: show the full dashboard grid as a 4×N
            // matrix of small cells. Cells occupied by the currently
            // selected size are highlighted; the rest are faint empties.
            // When a slot is targeted, the highlight starts at the slot's
            // (x, y) so users see where on the grid the widget will land.
            const PREVIEW_ROWS = 6
            const highlightX = doesFit ? slot.x : 0
            // Clamp the preview-Y so the highlight is always visible.
            // The dashboard's actual y can be > PREVIEW_ROWS (e.g. the
            // bottomless trailing slot at y = maxY ≫ 6), in which case
            // the cells used to drop entirely out of the 6-row mini-grid
            // and nothing was painted. Anchor the highlight to the
            // bottom of the preview instead.
            const rawY = doesFit ? slot.y : 0
            const highlightY = doesFit && rawY + current.h > PREVIEW_ROWS
              ? Math.max(0, PREVIEW_ROWS - current.h)
              : rawY
            return (
              <div
                key={def.id}
                className={`widget-picker-card${doesFit ? '' : ' is-disabled'}`}
                aria-disabled={!doesFit}
              >
                <div className="widget-picker-card-head">
                  <div className="widget-picker-card-title">{def.title}</div>
                  {def.description && (
                    <div className="widget-picker-card-desc">{def.description}</div>
                  )}
                </div>
                <div className="widget-picker-card-body">
                  <div className="widget-picker-preview-wrap">
                    <div
                      className="widget-picker-preview widget-picker-preview-grid"
                      aria-hidden
                    >
                      {Array.from({ length: PREVIEW_ROWS }).map((_, row) =>
                        Array.from({ length: COLS }).map((__, col) => {
                          const filled =
                            col >= highlightX &&
                            col < highlightX + current.w &&
                            row >= highlightY &&
                            row < highlightY + current.h
                          return (
                            <div
                              key={`${row}-${col}`}
                              className={`widget-picker-preview-cell${filled ? ' is-filled' : ''}`}
                            />
                          )
                        })
                      )}
                    </div>
                  </div>
                  <div className="widget-picker-card-controls">
                    {doesFit ? (
                      <>
                        <div className="widget-picker-sizes">
                          {sizes.map((s, i) => {
                            const isActive = current.w === s.w && current.h === s.h
                            return (
                              <button
                                key={`${s.w}x${s.h}-${i}`}
                                className={`widget-picker-size-chip${isActive ? ' is-active' : ''}`}
                                onClick={() => setSelected(prev => ({ ...prev, [def.id]: i }))}
                              >
                                {s.label ?? `${s.w}×${s.h}`}
                              </button>
                            )
                          })}
                        </div>
                        <button className="widget-picker-card-add" onClick={() => add(def)}>
                          + {t('customize.add')}
                        </button>
                      </>
                    ) : (
                      <div className="widget-picker-card-disabled-note">
                        {t('customize.notFitSlot')}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
            }),
          ].filter(Boolean))}
        </div>
      </div>
    </>
  )
}
