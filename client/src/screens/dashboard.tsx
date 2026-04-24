import { useState } from 'react'
import { format } from 'date-fns'
import type { Locale } from 'date-fns'
import { WidgetGrid, AddWidgetPicker, type WidgetDef } from '../widgets/grid'
import { useT } from '../i18n'
import type { Granularity, InsightsResponse, OverviewResponse } from '../types'
import { parseLocalDate, useDateLocale } from '../lib/format'
import { buildDashboardCatalog, buildInsightsCatalog } from '../widgets/registry'

/** Hour buckets arrive as "YYYY-MM-DD HH:00" — split before parseLocalDate
 *  so the date helper still gets a clean YYYY-MM-DD. */
function parseHourBucket(b: string): { date: Date; hour: number } {
  const [d, h] = b.split(' ')
  return { date: parseLocalDate(d), hour: parseInt(h.slice(0, 2), 10) }
}

function formatBucket(bucket: string, g: Granularity, dl: Locale): string {
  if (g === 'hour') {
    const { hour } = parseHourBucket(bucket)
    return `${String(hour).padStart(2, '0')}:00`
  }
  if (g === 'month') return format(parseLocalDate(bucket + '-01'), 'LLL yyyy', { locale: dl })
  if (g === 'week') {
    const start = parseLocalDate(bucket)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    return `${format(start, 'd MMM', { locale: dl })}-${format(end, 'd', { locale: dl })}`
  }
  return format(parseLocalDate(bucket), 'd MMM', { locale: dl })
}

/** Long-form bucket label for tooltips: includes year + weekday so users
 *  reading the popup don't have to guess what year a "12 Mar" point is.
 *  Axis labels stay compact (formatBucket above) for visual density. */
function formatBucketFull(bucket: string, g: Granularity, dl: Locale): string {
  if (g === 'hour') {
    const { date, hour } = parseHourBucket(bucket)
    const next = (hour + 1) % 24
    const day = format(date, 'EEEE, d MMMM yyyy', { locale: dl })
    return `${day} · ${String(hour).padStart(2, '0')}:00–${String(next).padStart(2, '0')}:00`
  }
  if (g === 'month') return format(parseLocalDate(bucket + '-01'), 'LLLL yyyy', { locale: dl })
  if (g === 'week') {
    const start = parseLocalDate(bucket)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    return `${format(start, 'd MMM yyyy', { locale: dl })} – ${format(end, 'd MMM yyyy', { locale: dl })}`
  }
  return format(parseLocalDate(bucket), 'EEEE, d MMMM yyyy', { locale: dl })
}

export function Dashboard({ data, modelNames, granularity, onSelectProject, inProjectView, insightsData, insightsProjectKey, editing, layoutEpoch, onLayoutReset, screenOverride, extraWidgets }: {
  data: OverviewResponse
  modelNames: string[]
  granularity: Granularity
  onSelectProject: (p: string) => void
  inProjectView: boolean
  insightsData?: InsightsResponse
  insightsProjectKey?: string | null
  editing: boolean
  layoutEpoch: number
  onLayoutReset: () => void
  /** Override the default screen-id derivation. Used by the day-view
   *  to share the Dashboard pipeline (catalog → DashboardView) while
   *  saving its layout under `screen='today'`. */
  screenOverride?: string
  /** Caller-supplied widgets appended to the catalog. Day-view uses
   *  this for day-only widgets (heatstrip, days-hours-heatmap,
   *  weekday-hour-heatmap) that need access to selectedDate state
   *  which lives in the day-view component. */
  extraWidgets?: WidgetDef[]
}) {
  const t = useT()
  const dl = useDateLocale()
  const activeBuckets = data.series.filter(r => Number(r.calls) > 0).length
  // Average over ACTIVE periods only — a $78 spend across 2 active days means $39/day of real usage,
  // not $2.61 smeared across 30 calendar days. Matches user intuition and aligns with the "Active X / Y" KPI next door.
  const avgPerBucket = activeBuckets > 0 ? data.totals.cost / activeBuckets : 0

  const series = data.series.map(row => ({
    ...row,
    _label: formatBucket(row.bucket as string, granularity, dl),
    _labelFull: formatBucketFull(row.bucket as string, granularity, dl),
  }))
  const hasAnyData = data.totals.calls > 0
  const hasTokenData = data.totals.inputTokens + data.totals.outputTokens + data.totals.cacheRead + data.totals.cacheWrite > 0

  // ─── Widget catalog ─────────────────────────────────────────────────
  // Each widget lives in its own file under src/widgets/dashboard/ and
  // src/widgets/insights/ and is assembled here via the registry. The id
  // is stable and matches server/lib/default-layouts.ts. The same catalog
  // covers both the dashboard and the project view; the server-side
  // default layout for each screen decides which widgets are initially
  // placed (e.g. cost-by-project / top-projects are dashboard-only).

  const catalog: WidgetDef[] = buildDashboardCatalog({
    t, data, modelNames, granularity, onSelectProject, inProjectView,
    series, hasAnyData, hasTokenData, activeBuckets, avgPerBucket,
  })

  // ─── Insights widgets — only registered when project view + data is loaded.
  // Insights widgets — always registered on the project screen, regardless
  // of whether insightsQuery has resolved yet. Previously this was gated
  // on `insightsData` being present, which meant:
  //   - the default PROJECT_DEFAULT layout has 18 widgets, but until the
  //     async /api/insights call lands the catalog only has 11 dashboard
  //     widgets, `reconcile()` filters out the 9 insights widgets as
  //     "unknown ids", and by the time the insights response arrives the
  //     user has already seen a truncated layout (and, worse, the empty
  //     handleChange path used to overwrite the server with 9 widgets).
  //   - projects that genuinely have no subagent/skills/etc data also
  //     never got those tiles registered in the engine, so toggling them
  //     in the "hide/show" picker in edit mode didn't work either.
  // Registering the widgets with an empty fallback means the tiles always
  // mount (rendering an empty state) and come alive once the real data
  // streams in — uniform layout across every project regardless of data
  // coverage. The `inProjectView` gate keeps these widgets out of the
  // main (non-project) Dashboard catalog.
  if (inProjectView) {
    const effectiveInsights: InsightsResponse = insightsData ?? {
      project: { key: '' },
      range: { start: '', end: '' },
      subagents: [], skills: [], mcp: [], bash: [],
      files: [], filesUnique: 0,
      flags: { plan_mode_calls: 0, todo_write_calls: 0, total_calls: 0 },
      branches: [], versions: [], heatmap: [],
    }
    catalog.push(...buildInsightsCatalog({ t, data: effectiveInsights, projectKey: insightsProjectKey ?? null, dl }))
  }
  if (extraWidgets && extraWidgets.length > 0) catalog.push(...extraWidgets)

  const screen = screenOverride ?? (inProjectView ? 'project' : 'dashboard')

  return (
    <DashboardView
      screen={screen}
      catalog={catalog}
      editing={editing}
      layoutEpoch={layoutEpoch}
      onLayoutReset={onLayoutReset}
    />
  )
}

export function DashboardView({ screen, catalog, editing, layoutEpoch, onLayoutReset }: {
  screen: string
  catalog: WidgetDef[]
  editing: boolean
  layoutEpoch: number
  onLayoutReset: () => void
}) {
  // Slot targeting: when a user clicks an empty-slot placeholder inside
  // the grid, we open the side-panel picker pre-targeted at that slot.
  // The bottom-row fill slot + row-break strips between rows cover every
  // insertion case, so there's no free-floating "add widget" toolbar button.
  const [slot, setSlot] = useState<{ x: number; y: number; maxW: number; maxH: number; insertMode?: 'gap' | 'row-break' } | null>(null)
  return (
    <>
      <WidgetGrid
        key={`${screen}-${layoutEpoch}`}
        screen={screen}
        catalog={catalog}
        editing={editing}
        onLayoutSettled={onLayoutReset}
        onSlotPick={setSlot}
      />
      {/* Slot-driven picker — controlled, hidden when no slot. */}
      {slot && (
        <AddWidgetPicker
          screen={screen}
          catalog={catalog}
          open
          slot={slot}
          onClose={() => setSlot(null)}
          onAdded={onLayoutReset}
        />
      )}
    </>
  )
}

