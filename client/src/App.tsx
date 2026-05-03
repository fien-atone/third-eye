import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query'
import { applyTheme, getStoredTheme, type Theme } from './theme'
import { useRoute, readRoute, navigate, type RouteFilters } from './router'
import { useScreenLayout, type ScreenLayout } from './widgets/grid'
import { useT } from './i18n'
import type { Granularity, OverviewResponse, ProvidersResponse, ProjectsResponse, VersionResponse } from './types'
import { parseLocalDate, toInputDate, useDateLocale } from './lib/format'
import { apiGet, apiPost, dashboardParams } from './api'
import { ProjectsPage } from './screens/projects-page'
import { Dashboard } from './screens/dashboard'
import { ProjectPage } from './screens/project-page'
import { DayView } from './screens/day-view'
import { NotFound } from './screens/not-found'
import { ConfirmDialog } from './components/confirm-dialog'
import { ServerDownBanner } from './components/server-down-banner'
import { Footer } from './components/footer'
import { AppHeader } from './components/app-header'
import { DashboardControls, DASHBOARD_DEFAULT_PRESET } from './components/dashboard-controls'

export default function App() {
  const route = useRoute()

  // ─── Dashboard filters: URL is the source of truth ───────────────────
  // The user's date range, granularity and provider selection live in
  // the URL hash query so refresh / back-forward / shared links all
  // preserve the view. State here is derived from `route.filters`;
  // user-driven changes go through `navigate(..., { replace: true })`
  // which rewrites the hash and lets useRoute push the new value back
  // through this derive-and-render loop. Replace-mode keeps history
  // clean — every keystroke in the date picker would otherwise add a
  // browser-history entry. The "Today" view feeds different routes
  // (`/today`, `/day/:date`) and ignores filters entirely.
  //
  // Default preset is computed ONCE at mount via useRef so it doesn't
  // shift as time passes (each render of `new Date()` would otherwise
  // re-anchor "30 days ago" and gradually drag the implicit window).
  const presetRef = useRef<{ start: Date; end: Date; granularity: Granularity } | null>(null)
  if (!presetRef.current) presetRef.current = DASHBOARD_DEFAULT_PRESET.get(1)
  const preset = presetRef.current

  const filters: RouteFilters | undefined =
    route.name === 'home' || route.name === 'project' ? route.filters : undefined

  // Derived state: read URL → fall back to preset. parseLocalDate is
  // memoized on the string so React.memo'd children don't see a new
  // Date instance on every render.
  const start = useMemo(
    () => (filters?.from ? parseLocalDate(filters.from) : preset.start),
    [filters?.from, preset],
  )
  const end = useMemo(
    () => (filters?.to ? parseLocalDate(filters.to) : preset.end),
    [filters?.to, preset],
  )
  const granularity: Granularity = filters?.granularity ?? preset.granularity
  const selectedProviders = useMemo(
    () => filters?.providers ?? [],
    [filters?.providers],
  )

  // updateFilters merges a patch into the current filter set and
  // pushes a new URL. Routes that don't carry filters (projects /
  // today / day / notfound) silently ignore the call — those screens
  // don't expose the dashboard control bar anyway. Empty arrays /
  // preset-matching values are dropped so the URL stays at `#/`
  // when the user is on defaults.
  const updateFilters = useCallback(
    (patch: Partial<{ start: Date; end: Date; granularity: Granularity; providers: string[] }>) => {
      // Read live route+filters synchronously so chained calls (e.g.
      // a preset click that fires setStart→setEnd→setGranularity in
      // rapid succession) compose against the latest URL, not the
      // stale React-derived snapshot. Each navigate() rewrites the
      // hash synchronously; React state catches up later.
      const live = readRoute()
      if (live.name !== 'home' && live.name !== 'project') return
      const liveFilters = live.filters
      const liveStart = liveFilters?.from ? parseLocalDate(liveFilters.from) : preset.start
      const liveEnd = liveFilters?.to ? parseLocalDate(liveFilters.to) : preset.end
      const liveG = liveFilters?.granularity ?? preset.granularity
      const liveProviders = liveFilters?.providers ?? []

      const nextStart = patch.start ?? liveStart
      const nextEnd = patch.end ?? liveEnd
      const nextG = patch.granularity ?? liveG
      const nextProviders = patch.providers ?? liveProviders
      const next: RouteFilters = {}
      // Only emit filters that differ from preset, so navigating
      // around with default settings keeps URLs short.
      const fromStr = toInputDate(nextStart)
      const toStr = toInputDate(nextEnd)
      if (fromStr !== toInputDate(preset.start)) next.from = fromStr
      if (toStr !== toInputDate(preset.end)) next.to = toStr
      if (nextG !== preset.granularity) next.granularity = nextG
      if (nextProviders.length > 0) next.providers = nextProviders
      const compact = Object.keys(next).length > 0 ? next : undefined
      if (live.name === 'home') {
        navigate({ name: 'home', filters: compact }, { replace: true })
      } else {
        navigate({ name: 'project', id: live.id, filters: compact }, { replace: true })
      }
    },
    [preset],
  )

  const setStart = useCallback((d: Date) => updateFilters({ start: d }), [updateFilters])
  const setEnd = useCallback((d: Date) => updateFilters({ end: d }), [updateFilters])
  const setGranularity = useCallback((g: Granularity) => updateFilters({ granularity: g }), [updateFilters])
  const setSelectedProviders = useCallback(
    (next: string[]) => updateFilters({ providers: next }),
    [updateFilters],
  )

  const [theme, setTheme] = useState<Theme>(getStoredTheme())
  // Customize / edit-layout mode for the widget grid. Per-screen — resets
  // automatically when the user navigates away from the dashboard or
  // project view (cleared in the route effect below).
  const [editingLayout, setEditingLayout] = useState(false)
  // Same threshold as widgets/grid.tsx MOBILE_BREAKPOINT — under it
  // GridStack is disabled and dragging/resizing has no effect, so hide
  // the customize controls entirely instead of letting the user enter
  // a state where nothing works.
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 720
  )
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 720)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  useEffect(() => { if (isNarrow && editingLayout) setEditingLayout(false) }, [isNarrow, editingLayout])
  const projectId = route.name === 'project' ? route.id : null
  const isNotFound = route.name === 'notfound'
  const isProjectsTab = route.name === 'projects'
  const isDayTab = route.name === 'today' || route.name === 'day'
  const dayDate = route.name === 'day' ? route.date : undefined
  // Which top-nav tab should LOOK active. The Projects tab lights up for
  // both the Projects LIST route and the individual PROJECT detail route —
  // a single project is conceptually a sub-view of Projects, not the
  // Dashboard. Routing (which screen to mount) still keys off isProjectsTab
  // above; this is purely presentation.
  const projectsTabActive = route.name === 'projects' || route.name === 'project'
  const dashboardTabActive = route.name === 'home'
  const dayTabActive = isDayTab
  const qc = useQueryClient()

  useEffect(() => { applyTheme(theme) }, [theme])

  // Document title — reflects the current screen so browser tabs / bookmarks /
  // history entries are distinguishable. Project page waits for the project
  // label to load before showing it (avoids "undefined · Third Eye" flash).
  // Pattern: "<Page> · Third Eye"

  const t = useT()
  const dl = useDateLocale()
  const weekStartsOn = (dl.options?.weekStartsOn ?? 1) as 0 | 1 | 2 | 3 | 4 | 5 | 6

  const providersQuery = useQuery<ProvidersResponse>({
    queryKey: ['providers'],
    queryFn: () => apiGet<ProvidersResponse>('/api/providers'),
  })

  const projectsQuery = useQuery<ProjectsResponse>({
    queryKey: ['projects'],
    queryFn: () => apiGet<ProjectsResponse>('/api/projects'),
  })

  // Strictly passive observer of the version cache. enabled:false
  // means RQ NEVER calls queryFn — no initial mount fetch, no
  // StrictMode double-fetch, nothing. The component only re-renders
  // when the singleton in lib/version-poll.ts pushes new data via
  // setQueryData. queryFn is required by the type system but is
  // unreachable.
  const versionQuery = useQuery<VersionResponse>({
    queryKey: ['version'],
    queryFn: () => apiGet<VersionResponse>('/api/version'),
    enabled: false,
  })

  const providersParam = selectedProviders.length === 0 ? 'all' : selectedProviders.join(',')
  const overviewKey = ['overview', start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), granularity, providersParam, projectId ?? '', weekStartsOn]
  const overviewQuery = useQuery<OverviewResponse>({
    queryKey: overviewKey,
    queryFn: () => apiGet<OverviewResponse>(`/api/overview?${dashboardParams({
      start, end, providers: providersParam, granularity, weekStartsOn, projectId,
    })}`),
    placeholderData: keepPreviousData,
  })

  // /api/health drives "is anything ingesting right now" — the
  // header spinner lights up for both manual Refresh AND background
  // auto-tick by reading this. Polling cadence is dynamic: 1.5 s
  // while an ingest is in flight (catch the transition off
  // promptly), 3 s while idle. The fast idle cadence is needed to
  // RELIABLY see the spinner during a short auto-tick — a typical
  // full ingest finishes in 5–7 s, so anything sparser than ~3 s
  // would miss most ticks (probability of catching a 6 s window
  // when polling every 15 s is only 6/15 ≈ 40%). The payload is
  // ~80 bytes; ~20 req/min is rounding error.
  type HealthResponse = {
    lastIngestAt: string | null
    ingestInProgress: { kind: 'incremental' | 'full' | 'rebuild'; startedAt: string } | null
  }
  const healthQuery = useQuery<HealthResponse>({
    queryKey: ['health'],
    queryFn: () => apiGet<HealthResponse>('/api/health'),
    refetchInterval: query => (query.state.data?.ingestInProgress ? 1_500 : 3_000),
  })

  const refreshMutation = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; durationMs: number; total: number }>('/api/refresh'),
    onSuccess: () => {
      // Invalidate everything that ingest can change. Without this the
      // "Manage agents" modal and the setup banner would keep their
      // cached role list until the next page reload — even though new
      // agents land in the DB on every refresh. Same for projects /
      // insights: a fresh ingest can surface a brand-new project.
      qc.invalidateQueries({ queryKey: ['providers'] })
      qc.invalidateQueries({ queryKey: ['overview'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['insights'] })
      qc.invalidateQueries({ queryKey: ['agents'] })
      // Health re-poll covers the auto-tick spinner: once the manual
      // mutation settles, in-flight state may still be true if a
      // background tick fired during the same window. Force a fresh
      // /api/health so the header reflects reality right away.
      qc.invalidateQueries({ queryKey: ['health'] })
    },
  })

  const data = overviewQuery.data
  const modelNames = useMemo(() => (data?.models ?? []).map(m => m.name).slice(0, 8), [data])
  // "Unresolved" = the backend confirmed there's no such project. While a
  // new projectId is being fetched, `overviewQuery.data` is still the
  // *previous* query's payload (keepPreviousData) which has no matching
  // `frame.project` for the new id — treating that as unresolved would
  // flash a 404 before the real data arrives. Wait until the new response
  // lands (`isPlaceholderData` flips to false) before committing.
  const unresolvedProject = !!projectId && !!data && !data.frame.project && !overviewQuery.isPlaceholderData

  // Reset edit mode when navigating away from a customizable screen.
  useEffect(() => { setEditingLayout(false) }, [route.name])

  // Snapshot of the layout at the moment edit mode is entered.
  // Cancel restores this; Done (toggling editing off) keeps current state.
  // Day-view saves under 'today' (matches screenOverride passed to
  // <Dashboard> from DayView). Without this Reset / Cancel on /today
  // would silently target the home dashboard layout.
  const editScreen = isDayTab ? 'today' : projectId ? 'project' : 'dashboard'
  const editLayout = useScreenLayout(editScreen)
  const editSnapshotRef = useRef<ScreenLayout | null>(null)
  // Epoch bumped on Cancel/Reset — used as a React `key` further down to
  // force the WidgetGrid (and its internal GridStack instance) to fully
  // remount with the new layout. GridStack doesn't diff incoming props
  // against its own state, so rebuilding is the cleanest reset.
  const [layoutEpoch, setLayoutEpoch] = useState(0)
  useEffect(() => {
    if (editingLayout && editLayout.query.data && !editSnapshotRef.current) {
      editSnapshotRef.current = editLayout.query.data
    }
    if (!editingLayout) editSnapshotRef.current = null
  }, [editingLayout, editLayout.query.data])
  const cancelEdit = () => {
    if (editSnapshotRef.current) editLayout.save.mutate(editSnapshotRef.current)
    setLayoutEpoch(e => e + 1)
    setEditingLayout(false)
  }
  // Reset current screen's layout to server defaults. Behind a styled
  // ConfirmDialog because it's destructive — wipes the user's widget
  // arrangement. The open flag drives the modal; doReset runs the
  // mutation and then bumps layoutEpoch so the WidgetGrid remounts from
  // the fresh default layout.
  const [resetOpen, setResetOpen] = useState(false)
  const resetLayout = () => setResetOpen(true)
  const doReset = async () => {
    setResetOpen(false)
    await editLayout.reset.mutateAsync()
    setLayoutEpoch(e => e + 1)
  }

  // Update document.title on route change.
  useEffect(() => {
    const brand = t('title.brand')
    let page: string
    if (route.name === 'notfound') page = t('title.notfound')
    else if (route.name === 'projects') page = t('title.projects')
    else if (route.name === 'project') {
      // Wait for the project label to load — otherwise show fallback.
      page = data?.frame.project?.label ?? t('title.dashboard')
    }
    else page = t('title.dashboard')
    // Brand first — product name leads so it stays visible even when the
    // browser truncates long tabs.
    document.title = `${brand} · ${page}`
  }, [route, data?.frame.project?.label, t])

  const claudeInScope = selectedProviders.length === 0 || selectedProviders.includes('claude')

  const toggleProvider = useCallback((id: string) => {
    const next = selectedProviders.includes(id)
      ? selectedProviders.filter(x => x !== id)
      : [...selectedProviders, id]
    setSelectedProviders(next)
  }, [selectedProviders, setSelectedProviders])

  const serverDown = providersQuery.isError || overviewQuery.isError
  const retryAll = () => {
    qc.invalidateQueries({ queryKey: ['providers'] })
    qc.invalidateQueries({ queryKey: ['projects'] })
    qc.invalidateQueries({ queryKey: ['overview'] })
    qc.invalidateQueries({ queryKey: ['insights'] })
  }

  return (
    <div className="app">
      <AppHeader
        lastIngestAt={healthQuery.data?.lastIngestAt ?? providersQuery.data?.lastIngestAt ?? null}
        isRefreshing={refreshMutation.isPending}
        // Header lights up its spinner on ANY in-flight ingest, not
        // just user-clicked ones. Auto-tick + lock-deduped manual
        // clicks both surface here. The header decides how to merge
        // the two signals (manual clicks get priority for the
        // disabled-state on the button itself).
        autoIngestKind={healthQuery.data?.ingestInProgress?.kind ?? null}
        onRefresh={() => refreshMutation.mutate()}
        theme={theme}
        setTheme={setTheme}
        showTabs={!isNotFound}
        dashboardTabActive={dashboardTabActive}
        projectsTabActive={projectsTabActive}
        dayTabActive={dayTabActive}
        version={versionQuery.data}
      />

      {serverDown && <ServerDownBanner onRetry={retryAll} />}

      {isProjectsTab && <ProjectsPage />}

      {isDayTab && (
        <DayView
          initialDate={dayDate}
          selectedProviders={selectedProviders}
          editing={editingLayout}
          setEditingLayout={setEditingLayout}
          isNarrow={isNarrow}
          onResetLayout={resetLayout}
          onCancelEdit={cancelEdit}
          layoutEpoch={layoutEpoch}
          onLayoutReset={() => {
            const y = window.scrollY
            setLayoutEpoch(e => e + 1)
            requestAnimationFrame(() => requestAnimationFrame(() => {
              window.scrollTo({ top: y, left: 0, behavior: 'instant' as ScrollBehavior })
            }))
          }}
          projectsData={projectsQuery.data}
        />
      )}

      {!isProjectsTab && !isDayTab && (
        <>
      <DashboardControls
        granularity={granularity}
        setGranularity={setGranularity}
        start={start}
        setStart={setStart}
        end={end}
        setEnd={setEnd}
        selectedProviders={selectedProviders}
        setSelectedProviders={setSelectedProviders}
        toggleProvider={toggleProvider}
        providersData={providersQuery.data}
        frame={data?.frame ?? null}
        isNarrow={isNarrow}
        editingLayout={editingLayout}
        setEditingLayout={setEditingLayout}
        onResetLayout={resetLayout}
        onCancelEdit={cancelEdit}
      />

      {(isNotFound || unresolvedProject) && <NotFound />}
      {!isNotFound && !unresolvedProject && overviewQuery.isLoading && !data && <div className="loading">{t('common.loading')}</div>}
      {!isNotFound && overviewQuery.error && <div className="error">{t('common.error')}: {(overviewQuery.error as Error).message}</div>}
      {!isNotFound && !unresolvedProject && data && (() => {
        const dashboardProps = {
          modelNames,
          granularity,
          onSelectProject: (key: string) => {
            const p = projectsQuery.data?.projects.find(x => x.key === key)
            if (p) navigate({ name: 'project', id: p.id })
          },
          editing: editingLayout,
          layoutEpoch,
          onLayoutReset: () => {
            // Bumping layoutEpoch remounts <WidgetGrid> from a clean
            // GridStack instance. During the unmount → mount window the
            // grid is briefly absent from the DOM, the document height
            // collapses, and the browser clamps the scroll position to
            // the new (smaller) max — usually 0 — making the page jerk
            // to the top. Snapshot scrollY pre-bump and restore it after
            // React commits the new tree (two RAFs: first paints the
            // empty state, second paints the new grid at full height).
            const y = window.scrollY
            setLayoutEpoch(e => e + 1)
            requestAnimationFrame(() => requestAnimationFrame(() => {
              window.scrollTo({ top: y, left: 0, behavior: 'instant' as ScrollBehavior })
            }))
          },
        }
        const lookedUp = projectsQuery.data?.projects.find(
          p => p.id === projectId || (data.frame.project && p.key === data.frame.project.key)
        ) ?? null
        return (
          <div className={overviewQuery.isFetching && overviewQuery.isPlaceholderData ? 'is-fetching' : ''}>
            {projectId ? (
              <ProjectPage
                projectId={projectId}
                data={data}
                start={start}
                end={end}
                providersParam={providersParam}
                claudeInScope={claudeInScope}
                lookedUpProject={lookedUp}
                dashboardProps={dashboardProps}
              />
            ) : (
              <Dashboard
                {...dashboardProps}
                data={data}
                inProjectView={false}
                insightsProjectKey={null}
              />
            )}
          </div>
        )
      })()}
        </>
      )}
      <Footer />
      <ConfirmDialog
        open={resetOpen}
        title={t('customize.resetTitle')}
        message={t('customize.resetConfirm')}
        confirmLabel={t('customize.reset')}
        cancelLabel={t('customize.cancel')}
        tone="destructive"
        onConfirm={doReset}
        onCancel={() => setResetOpen(false)}
      />
    </div>
  )
}

