/**
 * Widget grid system — generic, screen-agnostic.
 *
 * Each "screen" (dashboard, project, future settings…) defines its own
 * catalog of widgets locally and passes it to <WidgetGrid>. The grid:
 *   - loads the user's saved layout from the server
 *   - renders widgets in their saved positions
 *   - supports an Edit mode where widgets can be dragged, resized, removed
 *   - shows a "+" tile in Edit mode that opens an inline picker for any
 *     widget in the catalog that isn't currently placed
 *   - auto-saves layout changes (debounced 500ms)
 *
 * Keeps things proven: react-grid-layout handles drag/resize natively
 * (its absolute-positioning model is a deliberate trade for reliability
 * over CSS Grid acrobatics for resizable tiles).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import GridLayoutLib, { WidthProvider } from 'react-grid-layout'
import type { Layout } from 'react-grid-layout'
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query'
import { useT } from '../i18n'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

const ResponsiveGridLayout = WidthProvider(GridLayoutLib)

// ─── Types ────────────────────────────────────────────────────────────

export type WidgetDef = {
  /** Stable ID used as the key in saved layouts. Don't rename without a
   *  migration; old layouts still reference the old name. */
  id: string
  /** Human-readable title shown in the Add picker and as the optional
   *  drag-handle label in Edit mode. */
  title: string
  /** Render the widget body. Receives `editing` so widgets can hide
   *  hover-only affordances when the grid is in edit mode (chart
   *  tooltips, links) — most widgets ignore it. */
  render: (ctx: { editing: boolean }) => React.ReactNode
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

// ─── Hook: fetch + mutate the layout ──────────────────────────────────

export function useScreenLayout(screen: string) {
  const qc = useQueryClient()
  const query = useQuery<ScreenLayout>({
    queryKey: ['layout', screen],
    queryFn: async () => {
      const r = await fetch(`/api/layout/${screen}`)
      if (!r.ok) throw new Error(await r.text())
      return r.json()
    },
    placeholderData: keepPreviousData,
  })
  const save = useMutation({
    mutationFn: async (layout: ScreenLayout) => {
      const r = await fetch(`/api/layout/${screen}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(layout),
      })
      if (!r.ok) throw new Error(await r.text())
      return r.json()
    },
    onMutate: async (next) => {
      // Optimistic update — UI reflects the change immediately, server
      // catches up in the background.
      qc.setQueryData(['layout', screen], next)
    },
  })
  const reset = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/layout/${screen}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(await r.text())
      return r.json() as Promise<ScreenLayout>
    },
    onSuccess: (fresh) => {
      qc.setQueryData(['layout', screen], fresh)
    },
  })
  return { query, save, reset }
}

// ─── Layout sanitization ──────────────────────────────────────────────

/** Drop entries that reference unknown widget IDs (e.g. removed in a later
 *  release). Move newly-introduced widgets that aren't placed AND not in
 *  hidden into hidden — so the user can see them in the Add picker. */
function reconcile(layout: ScreenLayout, catalog: WidgetDef[]): ScreenLayout {
  const ids = new Set(catalog.map(w => w.id))
  const widgets = layout.widgets.filter(w => ids.has(w.i))
  const placedIds = new Set(widgets.map(w => w.i))
  const hidden = layout.hidden.filter(id => ids.has(id) && !placedIds.has(id))
  // Widgets in catalog but neither placed nor hidden → push to hidden so
  // they show up in the Add picker.
  for (const w of catalog) {
    if (!placedIds.has(w.id) && !hidden.includes(w.id)) hidden.push(w.id)
  }
  return { widgets, hidden }
}

// ─── <WidgetGrid> ─────────────────────────────────────────────────────

const COLS = 12
const ROW_HEIGHT = 60
const MARGIN: [number, number] = [12, 12]

type WidgetGridProps = {
  screen: string
  catalog: WidgetDef[]
  editing: boolean
  /** Width breakpoint — below this, render a single-column read-only stack
   *  (no drag/resize/edit on mobile). Defaults to 720. */
  mobileBreakpoint?: number
}

export function WidgetGrid({ screen, catalog, editing, mobileBreakpoint = 720 }: WidgetGridProps) {
  const { query, save } = useScreenLayout(screen)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < mobileBreakpoint)

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < mobileBreakpoint)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [mobileBreakpoint])

  const layout = useMemo(() => {
    if (!query.data) return null
    return reconcile(query.data, catalog)
  }, [query.data, catalog])

  // Debounced auto-save — coalesce rapid drag/resize updates into one PUT.
  const saveTimer = useRef<number | null>(null)
  const scheduleSave = useCallback((next: ScreenLayout) => {
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => save.mutate(next), 500)
  }, [save])

  if (!layout) return <div className="widget-grid-loading" />/* silent placeholder — overview itself shows a loading state */

  const catalogById = new Map(catalog.map(w => [w.id, w]))

  // ─── Mobile: single-column read-only stack in y-order ──────────────
  if (isMobile) {
    const ordered = [...layout.widgets].sort((a, b) => a.y - b.y || a.x - b.x)
    return (
      <div className="widget-grid widget-grid-mobile">
        {ordered.map(p => {
          const def = catalogById.get(p.i)
          if (!def) return null
          return (
            <div key={p.i} className="widget-tile widget-tile-mobile">
              {def.render({ editing: false })}
            </div>
          )
        })}
      </div>
    )
  }

  // ─── Desktop: react-grid-layout with edit affordances ──────────────
  const onLayoutChange = (newRGL: Layout[]) => {
    if (!editing) return  // ignore initial layout-pass when not editing
    const updated: Placed[] = newRGL.map(l => {
      const old = layout.widgets.find(w => w.i === l.i)
      return { i: l.i, x: l.x, y: l.y, w: l.w, h: l.h, minW: old?.minW, minH: old?.minH }
    })
    const next: ScreenLayout = { widgets: updated, hidden: layout.hidden }
    scheduleSave(next)
  }

  const removeWidget = (id: string) => {
    const next: ScreenLayout = {
      widgets: layout.widgets.filter(w => w.i !== id),
      hidden: layout.hidden.includes(id) ? layout.hidden : [...layout.hidden, id],
    }
    scheduleSave(next)
  }

  return (
    <ResponsiveGridLayout
      className={`widget-grid${editing ? ' is-editing' : ''}`}
      layout={layout.widgets as Layout[]}
      cols={COLS}
      rowHeight={ROW_HEIGHT}
      margin={MARGIN}
      isDraggable={editing}
      isResizable={editing}
      draggableHandle=".widget-tile-handle"
      onLayoutChange={onLayoutChange}
      compactType="vertical"
      preventCollision={false}
    >
      {layout.widgets.map(p => {
        const def = catalogById.get(p.i)
        if (!def) return null
        return (
          <div key={p.i} className="widget-tile" data-widget={p.i}>
            {editing && (
              <div className="widget-tile-handle" title={def.title}>
                <span className="widget-tile-title">{def.title}</span>
                <button
                  className="widget-tile-remove"
                  onClick={(e) => { e.stopPropagation(); removeWidget(p.i) }}
                  title="Remove from layout"
                  aria-label="Remove widget"
                >×</button>
              </div>
            )}
            <div className="widget-tile-body">{def.render({ editing })}</div>
          </div>
        )
      })}
    </ResponsiveGridLayout>
    /* AddPicker is rendered separately by the parent screen, so it can
       sit outside the react-grid-layout bounds. See <AddWidgetPicker>. */
  )
}

// ─── Add picker ───────────────────────────────────────────────────────

type AddPickerProps = {
  screen: string
  catalog: WidgetDef[]
}

/** Inline picker shown in Edit mode. Lists every widget that's currently
 *  hidden (i.e. in catalog but not on screen). Click → add to grid. */
export function AddWidgetPicker({ screen, catalog }: AddPickerProps) {
  const t = useT()
  const { query, save } = useScreenLayout(screen)
  const [open, setOpen] = useState(false)
  const layout = useMemo(() => query.data ? reconcile(query.data, catalog) : null, [query.data, catalog])
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close popover on outside click / Escape
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!layout) return null
  const available = layout.hidden
    .map(id => catalog.find(w => w.id === id))
    .filter((w): w is WidgetDef => !!w)

  if (available.length === 0) {
    return <div className="add-widget-empty">{t('customize.addEmpty')}</div>
  }

  const add = (id: string) => {
    const def = catalog.find(w => w.id === id)
    if (!def) return
    const maxY = layout.widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0)
    const placed: Placed = { i: id, x: 0, y: maxY, w: 6, h: 5, minW: 3, minH: 3 }
    save.mutate({
      widgets: [...layout.widgets, placed],
      hidden: layout.hidden.filter(h => h !== id),
    })
    setOpen(false)
  }

  return (
    <div className="add-widget" ref={wrapRef}>
      <button className="add-widget-btn" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        + {t('customize.add')} ({available.length})
      </button>
      {open && (
        <div className="add-widget-popover" role="menu">
          {available.map(w => (
            <button key={w.id} className="add-widget-item" onClick={() => add(w.id)} role="menuitem">
              {w.title}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
