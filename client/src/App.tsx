import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query'
import { applyTheme, getStoredTheme, type Theme } from './theme'
import { useRoute, navigate } from './router'
import { useScreenLayout, type ScreenLayout } from './widgets/grid'
import { useT } from './i18n'
import type { Granularity, OverviewResponse, ProvidersResponse, ProjectsResponse } from './types'
import { useDateLocale } from './lib/format'
import { apiGet, apiPost, dashboardParams } from './api'
import { ProjectsPage } from './screens/projects-page'
import { Dashboard } from './screens/dashboard'
import { ProjectPage } from './screens/project-page'
import { NotFound } from './screens/not-found'
import { ConfirmDialog } from './components/confirm-dialog'
import { ServerDownBanner } from './components/server-down-banner'
import { Footer } from './components/footer'
import { AppHeader } from './components/app-header'
import { DashboardControls, DASHBOARD_DEFAULT_PRESET } from './components/dashboard-controls'

export default function App() {
  const init = DASHBOARD_DEFAULT_PRESET.get(1)
  const [start, setStart] = useState<Date>(init.start)
  const [end, setEnd] = useState<Date>(init.end)
  const [granularity, setGranularity] = useState<Granularity>(init.granularity)
  const [selectedProviders, setSelectedProviders] = useState<string[]>([])
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
  const route = useRoute()
  const projectId = route.name === 'project' ? route.id : null
  const isNotFound = route.name === 'notfound'
  const isProjectsTab = route.name === 'projects'
  // Which top-nav tab should LOOK active. The Projects tab lights up for
  // both the Projects LIST route and the individual PROJECT detail route —
  // a single project is conceptually a sub-view of Projects, not the
  // Dashboard. Routing (which screen to mount) still keys off isProjectsTab
  // above; this is purely presentation.
  const projectsTabActive = route.name === 'projects' || route.name === 'project'
  const dashboardTabActive = route.name === 'home'
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

  const providersParam = selectedProviders.length === 0 ? 'all' : selectedProviders.join(',')
  const overviewKey = ['overview', start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), granularity, providersParam, projectId ?? '', weekStartsOn]
  const overviewQuery = useQuery<OverviewResponse>({
    queryKey: overviewKey,
    queryFn: () => apiGet<OverviewResponse>(`/api/overview?${dashboardParams({
      start, end, providers: providersParam, granularity, weekStartsOn, projectId,
    })}`),
    placeholderData: keepPreviousData,
  })

  const refreshMutation = useMutation({
    mutationFn: () => apiPost<{ ok: boolean; durationMs: number; total: number }>('/api/refresh'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['providers'] })
      qc.invalidateQueries({ queryKey: ['overview'] })
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
  const editScreen = projectId ? 'project' : 'dashboard'
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

  const toggleProvider = (id: string) => {
    setSelectedProviders(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

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
        lastIngestAt={providersQuery.data?.lastIngestAt ?? null}
        isRefreshing={refreshMutation.isPending}
        onRefresh={() => refreshMutation.mutate()}
        theme={theme}
        setTheme={setTheme}
        showTabs={!isNotFound}
        dashboardTabActive={dashboardTabActive}
        projectsTabActive={projectsTabActive}
      />

      {serverDown && <ServerDownBanner onRetry={retryAll} />}

      {isProjectsTab && <ProjectsPage />}

      {!isProjectsTab && (
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

