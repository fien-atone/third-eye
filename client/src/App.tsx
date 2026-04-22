import type React from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query'
import { format, parseISO, subDays, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addMonths, subMonths, eachDayOfInterval, isSameDay, isSameMonth, isToday, addDays } from 'date-fns'
import type { Locale } from 'date-fns'
import {
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { applyTheme, getStoredTheme, type Theme } from './theme'
import { useRoute, navigate, hrefFor } from './router'
import { Logo } from './Logo'
import { useT, useLocale, LOCALES, LOCALE_KEYS, type T } from './i18n'
import { DATE_LOCALES } from './i18n/dateLocale'

type Granularity = 'day' | 'week' | 'month'

type Provider = { id: string; label: string; calls: number; cost: number; firstTs: string; lastTs: string }
type ProvidersResponse = { providers: Provider[]; lastIngestAt: string | null }

type ProjectInfo = {
  id: string
  key: string
  label: string         // effective label (custom if set, otherwise auto)
  autoLabel: string     // original auto-derived label
  customLabel: string | null
  favorite: boolean
  calls: number
  cost: number
  firstTs: string
  lastTs: string
}
type ProjectsResponse = { projects: ProjectInfo[] }

type InsightsItem = { name: string; count: number; cost: number }
type VersionRow = { name: string; calls: number; cost: number; tokens: number; first_ts: string; last_ts: string }
type InsightsResponse = {
  project: { key: string }
  range: { start: string; end: string }
  subagents: InsightsItem[]
  skills: InsightsItem[]
  mcp: InsightsItem[]
  bash: InsightsItem[]
  files: InsightsItem[]
  filesUnique: number
  flags: { plan_mode_calls: number; todo_write_calls: number; total_calls: number }
  branches: Array<{ name: string; calls: number; cost: number }>
  versions: VersionRow[]
  heatmap: Array<{ dow: number; hour: number; calls: number; cost: number }>
}

type OverviewResponse = {
  frame: { start: string; end: string; granularity: Granularity; bucketCount: number; providers: string[]; project: { id: string | null; key: string; label: string } | null }
  totals: { cost: number; calls: number; inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number; projects: number }
  series: Array<Record<string, number | string>>
  models: Array<{ name: string; cost: number; calls: number; inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number }>
  categories: Array<{ name: string; cost: number; calls: number }>
  projects: Array<{ name: string; label: string; id: string | null; favorite: boolean; cost: number; calls: number }>
  topProjects: Array<{ key: string; id: string | null; label: string; cost: number; calls: number }>
  otherProjects: { count: number; cost: number }
  lastIngestAt: string | null
}

const COLORS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)',
  'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)', 'var(--chart-9)', 'var(--chart-10)',
]

function fmtCurrency(v: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: v < 10 ? 2 : 0 }).format(v)
}
function fmtInt(v: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(v))
}
function fmtTokens(v: number): string {
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k'
  return String(Math.round(v))
}
/** Hook: access the currently-selected date-fns Locale object. */
function useDateLocale() {
  const { locale } = useLocale()
  return DATE_LOCALES[locale]
}

/** Compact locale-aware date for table cells. Day + abbreviated month + year:
 *  en → "23 Apr 2026", ru → "23 апр. 2026". `tabular-nums` keeps numerals aligned. */
function useFmtDateCompact() {
  const dl = useDateLocale()
  return (iso: string) => format(parseISO(iso), 'd MMM yyyy', { locale: dl })
}

/** Reusable date primitive — table context (tabular-nums, dim color, locale-aware). */
function DateCell({ value, fallback = '—' }: { value: string | null | undefined; fallback?: string }) {
  const fmt = useFmtDateCompact()
  if (!value) return <span className="date-cell date-cell--empty">{fallback}</span>
  return <span className="date-cell" title={value}>{fmt(value)}</span>
}

/** Reusable date primitive — prose context (locale-aware longer form).
 *  Used in flowing text outside tables. CSS class `.date-text` is also available
 *  for one-off cases where the wrapper component is overkill. */
export function DateText({ value, fallback = '—' }: { value: string | null | undefined; fallback?: string }) {
  const dl = useDateLocale()
  if (!value) return <span className="date-text date-text--empty">{fallback}</span>
  return <span className="date-text" title={value}>{format(parseISO(value), 'd MMM yyyy', { locale: dl })}</span>
}

/** Middle-ellipsis text component. Truncates with `…` in the middle so both
 *  the start (e.g. `~/Desktop/`) and the end (e.g. `/telemetry/claude_stats`)
 *  stay visible — the end is usually the meaningful identifier for paths.
 *  When `query` is active, falls back to full text + <mark> highlighting so
 *  the match position remains visible (truncation would hide the match). */
function MidEllipsis({ text, query, className }: { text: string; query?: string; className?: string }) {
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
      // Tolerance: canvas measureText and DOM rendering differ by sub-pixel
      // amounts due to rounding and font-metric variations. Without slack,
      // a string that fits visually might be reported as "1px too wide" and
      // get aggressively middle-truncated (Builder? → Bu…). 4px is enough
      // headroom to absorb the noise without losing real overflow detection.
      const SLACK = 4
      if (ctx.measureText(text).width <= containerW + SLACK) {
        setDisplay(text)
        return
      }
      // Binary-search the largest number of total visible chars that still fits.
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

/** Highlight matched substring of `query` inside `text` with <mark>. Case-insensitive. */
function HighlightedText({ text, query }: { text: string; query: string }) {
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

function fmtRel(iso: string | null, t: T): string {
  if (!iso) return t('time.never')
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 1) return t('time.justNow')
  if (m < 60) return t('time.minAgo', { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('time.hourAgo', { n: h })
  return t('time.dayAgo', { n: Math.floor(h / 24) })
}
/** Parse a YYYY-MM-DD string as a local-calendar Date (NOT UTC midnight). */
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}
function formatBucket(bucket: string, g: Granularity, dl: Locale): string {
  if (g === 'month') return format(parseLocalDate(bucket + '-01'), 'LLL yyyy', { locale: dl })
  if (g === 'week') {
    const start = parseLocalDate(bucket)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    return `${format(start, 'd MMM', { locale: dl })}-${format(end, 'd', { locale: dl })}`
  }
  return format(parseLocalDate(bucket), 'd MMM', { locale: dl })
}
function formatFrameRange(startISO: string, endISO: string, g: Granularity, dl: Locale): string {
  const s = parseISO(startISO)
  const e = parseISO(endISO)
  if (g === 'month') return `${format(s, 'LLL yyyy', { locale: dl })} - ${format(e, 'LLL yyyy', { locale: dl })}`
  return `${format(s, 'PP', { locale: dl })} - ${format(e, 'PP', { locale: dl })}`
}

type PresetKey = 'preset.7d' | 'preset.30d' | 'preset.12w' | 'preset.mtd' | 'preset.12m'
type Preset = { key: PresetKey; get: (weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6) => { start: Date; end: Date; granularity: Granularity } }
const PRESETS: Preset[] = [
  { key: 'preset.7d',  get: () => ({ start: subDays(new Date(), 6), end: new Date(), granularity: 'day' }) },
  { key: 'preset.30d', get: () => ({ start: subDays(new Date(), 29), end: new Date(), granularity: 'day' }) },
  { key: 'preset.12w', get: (w) => ({ start: startOfWeek(subDays(new Date(), 83), { weekStartsOn: w }), end: endOfWeek(new Date(), { weekStartsOn: w }), granularity: 'week' }) },
  { key: 'preset.mtd', get: () => ({ start: startOfMonth(new Date()), end: endOfMonth(new Date()), granularity: 'day' }) },
  { key: 'preset.12m', get: () => {
    const e = new Date()
    const s = new Date(e.getFullYear() - 1, e.getMonth(), 1)
    return { start: s, end: endOfMonth(e), granularity: 'month' }
  } },
]

function toInputDate(d: Date): string { return format(d, 'yyyy-MM-dd') }

/** Centralised fetch wrapper. One place to handle:
 *  - non-OK status codes (turns body into a thrown Error)
 *  - JSON parsing
 *  - future cross-cutting concerns (request IDs, tracing, retries on 502/503) */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init)
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new Error(body || `HTTP ${r.status} on ${path}`)
  }
  return r.json() as Promise<T>
}
const apiGet = <T,>(path: string) => api<T>(path)
const apiPatch = <T,>(path: string, body: unknown) =>
  api<T>(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const apiPost = <T,>(path: string, body?: unknown) =>
  api<T>(path, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

/** Standard query params for the dashboard endpoints (overview / insights).
 *  Forces tzOffsetMin to be included — easy to forget when copy-pasting,
 *  and missing it makes server bucket calculations drift from the client's. */
function dashboardParams(opts: {
  start: Date
  end: Date
  providers: string
  granularity?: Granularity
  weekStartsOn?: number
  projectId?: string | null
}): URLSearchParams {
  const p = new URLSearchParams({
    start: toInputDate(opts.start),
    end: toInputDate(opts.end),
    providers: opts.providers,
    tzOffsetMin: String(-new Date().getTimezoneOffset()),
  })
  if (opts.granularity) p.set('granularity', opts.granularity)
  if (opts.weekStartsOn !== undefined) p.set('weekStartsOn', String(opts.weekStartsOn))
  if (opts.projectId) p.set('projectId', opts.projectId)
  return p
}

/**
 * Compact label for inline pills. Path-aware:
 *  ~/Desktop/Inoise/Global/TTRPG/app  →  TTRPG/app
 *  ~/Desktop/Inoise/Global/dnd/character/builder  →  character/builder
 *  long Cowork prompt text...  →  first ~22 chars + ellipsis
 */
function compactProjectLabel(label: string, max = 24): string {
  if (/[/\\]/.test(label)) {
    const parts = label.split(/[/\\]+/).filter(Boolean)
    const tail = parts.length >= 2 ? parts.slice(-2).join('/') : (parts[0] ?? label)
    return tail.length <= max ? tail : tail.slice(0, max - 1).trimEnd() + '…'
  }
  return label.length <= max ? label : label.slice(0, max - 1).trimEnd() + '…'
}

export default function App() {
  const init = PRESETS[1].get(1)
  const [start, setStart] = useState<Date>(init.start)
  const [end, setEnd] = useState<Date>(init.end)
  const [granularity, setGranularity] = useState<Granularity>(init.granularity)
  const [selectedProviders, setSelectedProviders] = useState<string[]>([])
  const [theme, setTheme] = useState<Theme>(getStoredTheme())
  const route = useRoute()
  const projectId = route.name === 'project' ? route.id : null
  const isNotFound = route.name === 'notfound'
  const isProjectsTab = route.name === 'projects'
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
  const unresolvedProject = !!projectId && !!data && !data.frame.project

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
  const insightsQuery = useQuery<InsightsResponse>({
    queryKey: ['insights', projectId, toInputDate(start), toInputDate(end), providersParam],
    queryFn: () => apiGet<InsightsResponse>(`/api/insights/${projectId}?${dashboardParams({
      start, end, providers: providersParam,
    })}`),
    enabled: !!projectId && claudeInScope,
    placeholderData: keepPreviousData,
  })

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
      <div className="header">
        <div className="brand">
          <a
            className="brand-link"
            href="/"
            onClick={e => { e.preventDefault(); navigate({ name: 'home' }) }}
            aria-label="Home"
          >
            <Logo size={28} />
            <h1>Third Eye</h1>
          </a>
          {typeof __APP_VERSION__ !== 'undefined' && (
            <span className="version-badge" title={`v${__APP_VERSION__}`}>v{__APP_VERSION__}</span>
          )}
          <span className="tagline">{t('header.tagline')}</span>
          <span className="meta">
            <span className="pulse" />
            {t('header.lastRefresh')}: {fmtRel(providersQuery.data?.lastIngestAt ?? null, t)}
          </span>
        </div>
        <div className="right">
          <button
            className="ghost"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            title={t('header.refreshTitle')}
          >
            {refreshMutation.isPending ? t('header.refreshing') : t('header.refresh')}
          </button>
          <LocaleSwitcher />
          <ThemeToggle theme={theme} setTheme={setTheme} />
        </div>
      </div>

      {serverDown && <ServerDownBanner onRetry={retryAll} />}

      {!isNotFound && (
        <div className="tabs" role="tablist">
          <a
            role="tab"
            aria-selected={!isProjectsTab}
            className={`tab${!isProjectsTab ? ' active' : ''}`}
            href={hrefFor({ name: 'home' })}
          >{t('nav.dashboard')}</a>
          <a
            role="tab"
            aria-selected={isProjectsTab}
            className={`tab${isProjectsTab ? ' active' : ''}`}
            href={hrefFor({ name: 'projects' })}
          >{t('nav.projects')}</a>
        </div>
      )}

      {isProjectsTab && <ProjectsPage />}

      {!isProjectsTab && (
        <>
      <div className="controls">
        <div className="group">
          <span className="group-label">{t('controls.view')}</span>
          {(['day', 'week', 'month'] as Granularity[]).map(g => (
            <button key={g} className={granularity === g ? 'active' : ''} onClick={() => setGranularity(g)}>
              {g === 'day' ? t('controls.day') : g === 'week' ? t('controls.week') : t('controls.month')}
            </button>
          ))}
        </div>
        <div className="sep" />
        <div className="group">
          {PRESETS.map(p => (
            <button key={p.key} onClick={() => {
              const v = p.get(weekStartsOn)
              setStart(v.start)
              setEnd(v.end)
              setGranularity(v.granularity)
            }}>{t(p.key)}</button>
          ))}
          <span className="date-range-inline">
            <DateField value={start} onChange={setStart} />
            <span className="date-range-sep">→</span>
            <DateField value={end} onChange={setEnd} />
          </span>
        </div>
        <div className="sep" />
        <div className="group">
          <button
            className={selectedProviders.length === 0 ? 'chip active' : 'chip'}
            onClick={() => setSelectedProviders([])}
          >{t('controls.allProviders')}</button>
          {(providersQuery.data?.providers ?? []).map(p => (
            <button
              key={p.id}
              className={selectedProviders.includes(p.id) ? 'chip active' : 'chip'}
              onClick={() => toggleProvider(p.id)}
              title={`${fmtInt(p.calls)} calls · ${fmtCurrency(p.cost)}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {data && (
        <div className="summary">
          <div>
            <strong>{formatFrameRange(data.frame.start, data.frame.end, granularity, dl)}</strong>
            <span className="dot">·</span>
            <span>{data.frame.bucketCount} {t(granularity === 'day' ? 'summary.days' : granularity === 'week' ? 'summary.weeks' : 'summary.months')}</span>
            <span className="dot">·</span>
            <span>{selectedProviders.length === 0 ? t('summary.allProviders') : selectedProviders.map(id => providersQuery.data?.providers.find(p => p.id === id)?.label ?? id).join(' + ')}</span>
          </div>
        </div>
      )}

      {projectId && data?.frame.project && (
        <div className="breadcrumb">
          <button onClick={() => navigate({ name: 'home' })}>{t('breadcrumb.allProjects')}</button>
          <span style={{ color: 'var(--text-dim)' }}>/</span>
          <span className="current" title={data.frame.project.key}>{data.frame.project.label}</span>
        </div>
      )}
      {(isNotFound || unresolvedProject) && <NotFound />}
      {!isNotFound && !unresolvedProject && overviewQuery.isLoading && !data && <div className="loading">{t('common.loading')}</div>}
      {!isNotFound && overviewQuery.error && <div className="error">{t('common.error')}: {(overviewQuery.error as Error).message}</div>}
      {!isNotFound && !unresolvedProject && data && (
        <div className={overviewQuery.isFetching && overviewQuery.isPlaceholderData ? 'is-fetching' : ''}>
          <Dashboard
            data={data}
            modelNames={modelNames}
            granularity={granularity}
            onSelectProject={(key) => {
              const p = projectsQuery.data?.projects.find(x => x.key === key)
              if (p) navigate({ name: 'project', id: p.id })
            }}
            inProjectView={!!projectId}
          />
        </div>
      )}
      {!isNotFound && !unresolvedProject && projectId && claudeInScope && insightsQuery.data && (
        <div className={insightsQuery.isFetching && insightsQuery.isPlaceholderData ? 'is-fetching' : ''}>
          <InsightsPanel data={insightsQuery.data} projectKey={data?.frame.project?.key ?? null} />
        </div>
      )}
        </>
      )}
      <Footer />
    </div>
  )
}

/** True on devices whose primary input has true hover (desktop mouse). False on phones/tablets. */
const canHover = typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches

function HelpTip({ children }: { children: React.ReactNode }) {
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
    // On touch devices, close when tapping anywhere outside the trigger.
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

  // Hover-capable devices (desktop): hover + focus controls open.
  // Touch-only devices: a single tap toggles, no synthesized mouseenter races.
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

function ServerDownBanner({ onRetry }: { onRetry: () => void }) {
  const t = useT()
  return (
    <div className="server-down">
      <div className="server-down-head">
        <span className="server-down-icon" aria-hidden="true">⚠</span>
        <div className="server-down-body">
          <div className="server-down-title">{t('server.down.title')}</div>
          <div className="server-down-msg">{t('server.down.msg')}</div>
        </div>
        <button className="primary" onClick={onRetry}>{t('server.down.retry')}</button>
      </div>
      <div className="server-down-cmds">
        <div className="cmd-row"><span className="cmd-label">{t('server.down.docker')}</span><code>docker compose up -d</code></div>
        <div className="cmd-row"><span className="cmd-label">{t('server.down.node')}</span><code>npm start</code></div>
        <div className="cmd-row"><span className="cmd-label">{t('server.down.check')}</span><code><a href="http://localhost:4317/api/health" target="_blank" rel="noreferrer">http://localhost:4317/api/health</a></code></div>
      </div>
    </div>
  )
}

type SortKey = 'name' | 'calls' | 'cost' | 'firstTs' | 'lastTs'
type SortDir = 'asc' | 'desc'

type ProjectsSort = { key: SortKey; dir: SortDir }
// Default: most-recently-active projects first. Inactive projects naturally
// sink to the bottom — replaces the old archive feature with sort order.
const DEFAULT_SORT: ProjectsSort = { key: 'lastTs', dir: 'desc' }
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200]

/** Single source of truth for search-match logic across a project's identifiers.
 *  Looks up the lowercased query against the visible label, the auto-derived
 *  label, and the raw filesystem key. Also reports WHICH identifier matched
 *  so the row can surface a secondary "why this one matched" hint. */
function projectSearchInfo(p: ProjectInfo, q: string) {
  if (!q) {
    // Without a query, we don't filter, but we may still want to show the
    // auto-label hint when the user has set a custom rename.
    return { matches: true, inLabel: false, inAuto: false, inKey: false, showAutoHint: !!p.customLabel, showKeyHint: false }
  }
  const inLabel = p.label.toLowerCase().includes(q)
  const inAuto = p.label !== p.autoLabel && p.autoLabel.toLowerCase().includes(q)
  const inKey = p.key.toLowerCase().includes(q)
  return {
    matches: inLabel || inAuto || inKey,
    inLabel,
    inAuto,
    inKey,
    // Surface the auto label when the match is in it OR when the user has
    // a custom rename and we didn't match the visible label (gives context).
    showAutoHint: !!p.customLabel || (inAuto && !inLabel),
    // Surface the raw key only when the match was there and nowhere else.
    showKeyHint: inKey && !inLabel && !inAuto,
  }
}

/** Paginator with page-size selector + nav. Rendered both above and below the all-projects table. */
function PaginationBar(props: {
  t: T
  page: number
  totalPages: number
  pageSize: number
  setPageSize: (n: number) => void
  setPage: (updater: number | ((p: number) => number)) => void
  pageStart: number
  pageEnd: number
  total: number
}) {
  const { t, page, totalPages, pageSize, setPageSize, setPage, pageStart, pageEnd, total } = props
  const onlyOnePage = totalPages <= 1
  return (
    <div className="pagination-bar">
      <label className="page-size-select">
        <span>{t('projects.perPage')}</span>
        <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
          {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <span className="pagination-info">{t('projects.pageInfo', { start: pageStart, end: pageEnd, total })}</span>
      <div className="pagination-controls">
        <button
          className="btn-page"
          disabled={onlyOnePage || page <= 1}
          onClick={() => setPage(1)}
          aria-label={t('projects.first')}
        >«</button>
        <button
          className="btn-page"
          disabled={onlyOnePage || page <= 1}
          onClick={() => setPage(p => Math.max(1, p - 1))}
          aria-label={t('projects.prev')}
        >‹</button>
        <span className="pagination-page">{page} / {totalPages}</span>
        <button
          className="btn-page"
          disabled={onlyOnePage || page >= totalPages}
          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          aria-label={t('projects.next')}
        >›</button>
        <button
          className="btn-page"
          disabled={onlyOnePage || page >= totalPages}
          onClick={() => setPage(totalPages)}
          aria-label={t('projects.last')}
        >»</button>
      </div>
    </div>
  )
}

function sortProjects(rows: ProjectInfo[], s: ProjectsSort): ProjectInfo[] {
  const dir = s.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    let cmp = 0
    if (s.key === 'name') cmp = a.label.localeCompare(b.label)
    else if (s.key === 'calls') cmp = a.calls - b.calls
    else if (s.key === 'cost') cmp = a.cost - b.cost
    else if (s.key === 'firstTs') cmp = (a.firstTs || '').localeCompare(b.firstTs || '')
    else if (s.key === 'lastTs') cmp = (a.lastTs || '').localeCompare(b.lastTs || '')
    return cmp * dir
  })
}

function ProjectsPage() {
  const t = useT()
  const dl = useDateLocale()
  const qc = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [favSort, setFavSort] = useState<ProjectsSort>(DEFAULT_SORT)
  const [restSort, setRestSort] = useState<ProjectsSort>(DEFAULT_SORT)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [pageSize, setPageSize] = useState<number>(50)
  const [page, setPage] = useState(1)
  // Debounce search input
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 150)
    return () => clearTimeout(id)
  }, [search])

  // Reset page when search/filters change
  useEffect(() => { setPage(1) }, [debouncedSearch, pageSize])

  const projectsQuery = useQuery<ProjectsResponse>({
    queryKey: ['projects'],
    queryFn: () => apiGet<ProjectsResponse>('/api/projects'),
  })

  const patchMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<{ customLabel: string | null; favorite: boolean }> }) =>
      apiPatch<ProjectInfo>(`/api/projects/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['overview'] })
    },
  })

  const startEdit = (p: ProjectInfo) => {
    setEditingId(p.id)
    setEditValue(p.customLabel ?? p.autoLabel)
  }
  const saveEdit = (id: string) => {
    const trimmed = editValue.trim()
    patchMutation.mutate({ id, body: { customLabel: trimmed || null } })
    setEditingId(null)
  }
  const cancelEdit = () => { setEditingId(null); setEditValue('') }
  const resetToAuto = (id: string) => {
    patchMutation.mutate({ id, body: { customLabel: null } })
    setEditingId(null)
  }
  const toggleFavorite = (p: ProjectInfo) => {
    patchMutation.mutate({ id: p.id, body: { favorite: !p.favorite } })
  }

  const all = projectsQuery.data?.projects ?? []

  // Search filter — projectSearchInfo decides what counts as a match.
  const q = debouncedSearch.toLowerCase()
  const filtered = q
    ? all.filter(p => projectSearchInfo(p, q).matches)
    : all

  // Step 3: split into favorites and rest
  const favRows = sortProjects(filtered.filter(p => p.favorite), favSort)
  const restRowsAll = sortProjects(filtered.filter(p => !p.favorite), restSort)

  // Step 4: paginate rest only
  const totalPages = Math.max(1, Math.ceil(restRowsAll.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const restRows = restRowsAll.slice((safePage - 1) * pageSize, safePage * pageSize)

  const renderRow = (p: ProjectInfo) => {
    const isEditing = editingId === p.id
    const { showAutoHint, showKeyHint } = projectSearchInfo(p, q)

    return (
      <div
        key={p.id}
        role="row"
        className={`grid-row${p.favorite ? ' favorite-row' : ''}`}
      >
        {!isEditing && (
          <a
            className="row-link"
            href={hrefFor({ name: 'project', id: p.id })}
            aria-label={t('projects.openProject') + ': ' + p.label}
          />
        )}
        <div role="cell" className="cell cell-fav">
          <button
            className={`btn-star${p.favorite ? ' on' : ''}`}
            onClick={() => toggleFavorite(p)}
            title={p.favorite ? t('projects.unfavorite') : t('projects.favorite')}
            aria-label={p.favorite ? t('projects.unfavorite') : t('projects.favorite')}
          >{p.favorite ? '★' : '☆'}</button>
        </div>
        <div role="cell" className="cell cell-name">
          {isEditing ? (
            <div className="name-edit">
              <input
                autoFocus
                type="text"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveEdit(p.id)
                  else if (e.key === 'Escape') cancelEdit()
                }}
                placeholder={t('projects.editPlaceholder')}
                maxLength={200}
              />
              <button className="btn-save" onClick={() => saveEdit(p.id)} title={t('projects.save')}>✓</button>
              <button className="btn-cancel" onClick={cancelEdit} title={t('projects.cancel')}>×</button>
              {p.customLabel && (
                <button className="btn-reset" onClick={() => resetToAuto(p.id)} title={t('projects.reset')}>⟲</button>
              )}
            </div>
          ) : (
            <div className="name-display">
              <div className="name-main">
                <span className="name-main-wrap">
                  <MidEllipsis text={p.label} query={q} />
                </span>
              </div>
              {showAutoHint && (
                <div className="name-auto">
                  <span className="name-auto-prefix">{t('projects.sessionLabel')}: </span>
                  <span className="name-auto-wrap">
                    <MidEllipsis text={p.autoLabel} query={q} />
                  </span>
                </div>
              )}
              {showKeyHint && (
                <div className="name-auto">
                  <span className="name-auto-prefix">{t('projects.sessionLabel')}: </span>
                  <span className="name-auto-wrap">
                    <MidEllipsis text={p.key} query={q} />
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
        <div role="cell" className="cell cell-num cell-calls">{fmtInt(p.calls)}</div>
        <div role="cell" className="cell cell-num cell-cost">{fmtCurrency(p.cost)}</div>
        <div role="cell" className="cell cell-num cell-first"><DateCell value={p.firstTs} /></div>
        <div role="cell" className="cell cell-num cell-last"><DateCell value={p.lastTs} /></div>
        <div role="cell" className="cell cell-actions">
          {!isEditing && (
            <button
              className="btn-icon"
              onClick={() => startEdit(p)}
              title={t('projects.editTitle')}
              aria-label={t('projects.editTitle')}
            >✎</button>
          )}
        </div>
      </div>
    )
  }

  const renderTable = (rows: ProjectInfo[], sort: ProjectsSort, setSort: (s: ProjectsSort) => void) => {
    const onSortClick = (key: SortKey) => {
      if (key === sort.key) setSort({ key, dir: sort.dir === 'asc' ? 'desc' : 'asc' })
      else setSort({ key, dir: key === 'name' ? 'asc' : 'desc' })
    }
    /** Indicator next to a column header. Active sort gets a bright ↑/↓;
     *  every other sortable column gets a dim ↕ so the user can SEE
     *  that all of them are clickable, not just the currently-sorted one. */
    const sortIcon = (key: SortKey) => {
      if (sort.key === key) {
        return <span className="sort-arrow active">{sort.dir === 'asc' ? '↑' : '↓'}</span>
      }
      return <span className="sort-arrow">↕</span>
    }
    return (
      <div className="projects-grid" role="table">
        <div role="row" className="grid-head">
          <div role="columnheader" className="cell cell-fav" title={t('projects.favorite')}>★</div>
          <div role="columnheader" className="cell cell-name sortable" onClick={() => onSortClick('name')}>{t('projects.colName')} {sortIcon('name')}</div>
          <div role="columnheader" className="cell cell-num cell-calls sortable" onClick={() => onSortClick('calls')}>{t('projects.colCalls')} {sortIcon('calls')}</div>
          <div role="columnheader" className="cell cell-num cell-cost sortable" onClick={() => onSortClick('cost')}>{t('projects.colCost')} {sortIcon('cost')}</div>
          <div role="columnheader" className="cell cell-num cell-first sortable" onClick={() => onSortClick('firstTs')}>{t('projects.colFirstSeen')} {sortIcon('firstTs')}</div>
          <div role="columnheader" className="cell cell-num cell-last sortable" onClick={() => onSortClick('lastTs')}>{t('projects.colLastSeen')} {sortIcon('lastTs')}</div>
          <div role="columnheader" className="cell cell-actions" aria-label={t('projects.colActions')} />
        </div>
        {rows.map(renderRow)}
      </div>
    )
  }

  const totalRest = restRowsAll.length
  const pageStart = totalRest === 0 ? 0 : (safePage - 1) * pageSize + 1
  const pageEnd = Math.min(safePage * pageSize, totalRest)
  const noMatches = projectsQuery.data && filtered.length === 0

  return (
    <div className="projects-page">
      <div className="projects-page-header">
        <div>
          <h2 className="projects-page-title">{t('projects.title')}</h2>
          <div className="projects-page-sub">{t('projects.subtitle')}</div>
        </div>
        <div className="projects-page-controls">
          <input
            type="search"
            className="projects-search"
            placeholder={t('projects.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label={t('projects.searchPlaceholder')}
          />
        </div>
      </div>

      {projectsQuery.isLoading && <div className="loading">{t('common.loading')}</div>}
      {projectsQuery.error && <div className="error">{(projectsQuery.error as Error).message}</div>}

      {noMatches && (
        <ChartEmpty height={200} hint={debouncedSearch ? t('projects.noMatches') : t('projects.empty')} />
      )}

      {projectsQuery.data && favRows.length > 0 && (
        <div className="projects-block">
          <div className="projects-block-header">
            <span className="projects-block-title">{t('projects.favoritesSection')}</span>
            <span className="projects-block-count">{favRows.length}</span>
          </div>
          <div className="panel" style={{ padding: 0 }}>
            {renderTable(favRows, favSort, setFavSort)}
          </div>
        </div>
      )}

      {projectsQuery.data && restRowsAll.length > 0 && (
        <div className="projects-block">
          <div className="projects-block-header">
            <span className="projects-block-title">{t('projects.allSection')}</span>
            <span className="projects-block-count">{totalRest}</span>
          </div>
          <PaginationBar
            t={t}
            page={safePage}
            totalPages={totalPages}
            pageSize={pageSize}
            setPageSize={setPageSize}
            setPage={setPage}
            pageStart={pageStart}
            pageEnd={pageEnd}
            total={totalRest}
          />
          <div className="panel" style={{ padding: 0 }}>
            {renderTable(restRows, restSort, setRestSort)}
          </div>
          <PaginationBar
            t={t}
            page={safePage}
            totalPages={totalPages}
            pageSize={pageSize}
            setPageSize={setPageSize}
            setPage={setPage}
            pageStart={pageStart}
            pageEnd={pageEnd}
            total={totalRest}
          />
        </div>
      )}

      {/* keep date-fns locale referenced so unused-warning doesn't fire if formatBucket isn't called */}
      <span style={{ display: 'none' }}>{dl.code}</span>
    </div>
  )
}

function NotFound() {
  const t = useT()
  return (
    <div className="notfound">
      <div className="notfound-logo"><Logo size={72} /></div>
      <div className="notfound-code">{t('notfound.code')}</div>
      <div className="notfound-title">{t('notfound.title')}</div>
      <div className="notfound-msg">{t('notfound.message')}</div>
      <button className="primary" onClick={() => navigate({ name: 'home' })}>
        {t('notfound.home')}
      </button>
    </div>
  )
}

function ChartEmpty({ height = 260, hint }: { height?: number; hint?: string }) {
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

function PanelHeader({ title, sub, help }: { title: string; sub?: string; help?: React.ReactNode }) {
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

function InsightsPanel({ data, projectKey }: { data: InsightsResponse; projectKey: string | null }) {
  const t = useT()
  const dl = useDateLocale()
  const weekStartsOn = (dl.options?.weekStartsOn ?? 1) as 0 | 1 | 2 | 3 | 4 | 5 | 6
  const fileBasename = (p: string) => p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p
  const stripProjectPrefix = (path: string) => {
    if (!projectKey) return path
    const real = projectKey.replace(/^-?Users-([^-]+)-/, '/Users/$1/').replace(/-/g, '/')
    return path.startsWith(real) ? path.slice(real.length).replace(/^\//, '') : path
  }

  // Day names indexed 0=Sun..6=Sat (matches SQLite strftime('%w')).
  // Row order on the heatmap is derived from weekStartsOn so RU/DE/ES start from Monday, EN/ZH from Sunday.
  const dayNames = [t('day.sun'), t('day.mon'), t('day.tue'), t('day.wed'), t('day.thu'), t('day.fri'), t('day.sat')]
  const rowOrder = Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7)
  const heatGrid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  let heatMax = 0
  for (const c of data.heatmap) {
    heatGrid[c.dow][c.hour] = c.calls
    if (c.calls > heatMax) heatMax = c.calls
  }

  return (
    <div className="insights">
      <h2 className="insights-title">{t('insights.title')}</h2>

      <div className="grid col-2">
        <InsightsList
          title={t('insights.subagents.title')}
          subtitle={t('insights.subagents.sub')}
          rows={data.subagents}
          unit={t('common.calls')}
          help={t('insights.subagents.help')}
        />
        <InsightsList
          title={t('insights.skills.title')}
          subtitle={t('insights.skills.sub')}
          rows={data.skills}
          unit={t('common.calls')}
          help={t('insights.skills.help')}
        />
        <InsightsList
          title={t('insights.mcp.title')}
          subtitle={t('insights.mcp.sub')}
          rows={data.mcp}
          unit={t('common.calls')}
          help={t('insights.mcp.help')}
        />
        <InsightsList
          title={t('insights.bash.title')}
          subtitle={t('insights.bash.sub')}
          rows={data.bash}
          unit={t('common.runs')}
          help={t('insights.bash.help')}
        />
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <PanelHeader
          title={t('insights.files.title')}
          sub={t('insights.files.subFmt', { unique: fmtInt(data.filesUnique), shown: data.files.length })}
          help={t('insights.files.help')}
        />
        <table className="file-hotspots-table">
          <colgroup>
            <col style={{ width: 'auto' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '90px' }} />
          </colgroup>
          <thead><tr><th>{t('insights.files.colFile')}</th><th className="num">{t('insights.files.colTouches')}</th><th className="num">{t('insights.files.colCost')}</th></tr></thead>
          <tbody>
            {data.files.map(f => {
              const stripped = stripProjectPrefix(f.name)
              const base = fileBasename(stripped)
              const dir = stripped.slice(0, -base.length)
              return (
                <tr key={f.name}>
                  <td>
                    <div className="file-path-cell" tabIndex={0} title={f.name}>
                      <span className="file-dir">{dir}</span>
                      <span className="file-name">{base}</span>
                      <span className="file-full" role="tooltip">{f.name}</span>
                    </div>
                  </td>
                  <td className="num">{fmtInt(f.count)}</td>
                  <td className="num">{fmtCurrency(f.cost)}</td>
                </tr>
              )
            })}
            {data.files.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--text-dim)' }}>{t('insights.files.empty')}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="grid col-2" style={{ marginTop: 14 }}>
        <div className="panel">
          <PanelHeader
            title={t('insights.flags.title')}
            help={t('insights.flags.help')}
          />
          <div className="flag-grid">
            <FlagStat label={t('insights.flags.planMode')} value={data.flags.plan_mode_calls} total={data.flags.total_calls} />
            <FlagStat label={t('insights.flags.todoWrite')} value={data.flags.todo_write_calls} total={data.flags.total_calls} />
          </div>
        </div>
        <VersionsPanel rows={data.versions} />
      </div>

      <div className="grid col-2" style={{ marginTop: 14 }}>
        <div className="panel">
          <PanelHeader
            title={t('insights.branches.title')}
            sub={t('insights.branches.sub')}
            help={t('insights.branches.help')}
          />
          {data.branches.length === 0 ? (
            <ChartEmpty height={160} hint={t('insights.branches.empty')} />
          ) : (
            <table className="breakdown">
              <thead><tr><th>{t('insights.branches.colBranch')}</th><th className="num">{t('insights.branches.colCalls')}</th><th className="num">{t('insights.branches.colCost')}</th></tr></thead>
              <tbody>
                {data.branches.map(b => (
                  <tr key={b.name}>
                    <td style={{ wordBreak: 'break-all' }}><span style={{ fontFamily: 'ui-monospace, monospace' }}>{b.name}</span></td>
                    <td className="num">{fmtInt(b.calls)}</td>
                    <td className="num">{fmtCurrency(b.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <PanelHeader
            title={t('insights.heatmap.title')}
            sub={t('insights.heatmap.sub')}
            help={t('insights.heatmap.help')}
          />
          <div className="heatmap">
            <div className="heatmap-hours">
              <div className="heatmap-corner" />
              {Array.from({ length: 24 }, (_, h) => (
                <div className="heatmap-hour" key={h}>{h % 3 === 0 ? h : ''}</div>
              ))}
            </div>
            {rowOrder.map(dow => (
              <div className="heatmap-row" key={dow}>
                <div className="heatmap-day">{dayNames[dow]}</div>
                {heatGrid[dow].map((calls, hour) => {
                  const intensity = heatMax > 0 ? calls / heatMax : 0
                  return (
                    <div
                      key={hour}
                      className="heatmap-cell"
                      style={{ background: intensity > 0 ? `rgba(255, 140, 66, ${0.15 + intensity * 0.85})` : 'var(--bg-2)' }}
                      title={`${dayNames[dow]} ${hour}:00 — ${calls}`}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function InsightsList({ title, subtitle, rows, unit, help }: { title: string; subtitle: string; rows: InsightsItem[]; unit: string; help?: React.ReactNode }) {
  const max = Math.max(1, ...rows.map(r => r.count))
  return (
    <div className="panel">
      <PanelHeader title={title} sub={subtitle} help={help} />
      {rows.length === 0 ? (
        <ChartEmpty height={140} />
      ) : (
        <div className="insights-list">
          {rows.slice(0, 12).map((r, i) => (
            <div className="insights-row" key={r.name + i}>
              <div className="insights-bar" style={{ width: `${(r.count / max) * 100}%` }} />
              <div className="insights-row-content">
                <span className="insights-name" title={r.name}>{r.name}</span>
                <span className="insights-meta">{fmtInt(r.count)} {unit} · {fmtCurrency(r.cost)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

type VersionMetric = 'cost' | 'calls' | 'tokens'

function VersionsPanel({ rows }: { rows: VersionRow[] }) {
  const t = useT()
  const [metric, setMetric] = useState<VersionMetric>('cost')
  const fmt = metric === 'cost' ? fmtCurrency : metric === 'calls' ? fmtInt : fmtTokens
  const total = rows.reduce((s, v) => s + (v[metric] ?? 0), 0)
  const sorted = [...rows].sort((a, b) => (b[metric] ?? 0) - (a[metric] ?? 0))
  const pieData = sorted.map(v => ({ name: v.name, value: v[metric] ?? 0 }))
  const metricLabel = metric === 'cost' ? t('insights.versions.metricCost') : metric === 'calls' ? t('insights.versions.metricCalls') : t('insights.versions.metricTokens')

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="panel-title-row">
            <h3 style={{ margin: 0 }}>{t('insights.versions.title')}</h3>
            <HelpTip>{t('insights.versions.help')}</HelpTip>
          </div>
          <span className="panel-sub">{t('insights.versions.subFmt', { count: rows.length, value: fmt(total) })}</span>
        </div>
        <div className="group" style={{ gap: 5 }}>
          <button className={`chip${metric === 'cost' ? ' active' : ''}`} onClick={() => setMetric('cost')}>{t('insights.versions.metricCost')}</button>
          <button className={`chip${metric === 'calls' ? ' active' : ''}`} onClick={() => setMetric('calls')}>{t('insights.versions.metricCalls')}</button>
          <button className={`chip${metric === 'tokens' ? ' active' : ''}`} onClick={() => setMetric('tokens')}>{t('insights.versions.metricTokens')}</button>
        </div>
      </div>
      {rows.length === 0 ? (
        <ChartEmpty height={200} hint={t('insights.versions.empty')} />
      ) : (
        <div className="versions-layout">
          <div className="versions-chart">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={88} paddingAngle={1} isAnimationActive={false}>
                  {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="var(--panel)" strokeWidth={2} />)}
                </Pie>
                <Tooltip content={<VersionTooltip total={total} fmt={fmt} />} animationDuration={0} isAnimationActive={false} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="versions-table">
            <table className="breakdown">
              <thead><tr><th>{t('insights.versions.colVersion')}</th><th className="num">{t('insights.versions.colShare')}</th><th className="num">{metricLabel}</th><th className="num">{t('insights.versions.colFirstSeen')}</th></tr></thead>
              <tbody>
                {sorted.map((v, i) => {
                  const pct = total > 0 ? ((v[metric] ?? 0) / total) * 100 : 0
                  return (
                    <tr key={v.name}>
                      <td>
                        <span className="swatch" style={{ background: `var(--chart-${(i % 10) + 1})` }} />
                        <span style={{ fontFamily: 'ui-monospace, monospace' }}>{v.name}</span>
                      </td>
                      <td className="num">{pct.toFixed(1)}%</td>
                      <td className="num">{fmt(v[metric] ?? 0)}</td>
                      <td className="num"><DateCell value={v.first_ts} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function VersionTooltip({ active, payload, total, fmt }: TTProps & { total: number; fmt: (v: number) => string }) {
  if (!active || !payload || payload.length === 0) return null
  const d = payload[0]?.payload
  if (!d) return null
  const pct = total > 0 ? (d.value / total) * 100 : 0
  return (
    <div className="tooltip">
      <div className="tt-title">v{d.name}</div>
      <div className="tt-row"><span>Value</span><span className="tt-val">{fmt(d.value)}</span></div>
      <div className="tt-row"><span>Share</span><span className="tt-val">{pct.toFixed(1)}%</span></div>
    </div>
  )
}

function FlagStat({ label, value, total }: { label: string; value: number; total: number }) {
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

function Footer() {
  const year = new Date().getFullYear()
  const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null
  return (
    <footer className="footer">
      <div>
        © {year} Ivan Shumov
        <span className="dot">·</span>
        <a href="mailto:contact@ivanshumov.com">contact@ivanshumov.com</a>
      </div>
      <div>
        {version && (
          <>
            <a
              className="footer-version"
              href="https://github.com/inoise/third-eye/releases"
              target="_blank"
              rel="noopener noreferrer"
              title="Compare to the latest release on GitHub"
            >v{version}</a>
            <span className="dot">·</span>
          </>
        )}
        <span className="badge">MIT</span>
      </div>
    </footer>
  )
}

function DateField({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
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

function ThemeToggle({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const t = useT()
  const next: Record<Theme, Theme> = { light: 'dark', dark: 'system', system: 'light' }
  const label: Record<Theme, string> = {
    light: t('header.theme.light'),
    dark: t('header.theme.dark'),
    system: t('header.theme.system'),
  }
  const icon: Record<Theme, string> = { light: '☀', dark: '☾', system: '◐' }
  return (
    <button className="ghost" onClick={() => setTheme(next[theme])} title={`${t('header.theme.title')}: ${label[theme]} (${t('header.theme.cycle')})`}>
      <span style={{ marginRight: 6 }}>{icon[theme]}</span>{label[theme]}
    </button>
  )
}

function LocaleSwitcher() {
  const { locale, setLocale } = useLocale()
  const t = useT()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const tr = triggerRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const width = 160
    let left = tr.right - width
    if (left < 8) left = 8
    if (left + width > vw - 8) left = vw - 8 - width
    setPos({ left, top: tr.bottom + 6 })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onScroll = () => setOpen(false)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        className="ghost"
        onClick={() => setOpen(o => !o)}
        title={t('header.locale.title')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span style={{ marginRight: 6 }}>{LOCALES[locale].flag}</span>{LOCALES[locale].native}
      </button>
      {open && pos && (
        <div
          ref={menuRef}
          className="locale-menu"
          role="menu"
          style={{ position: 'fixed', left: pos.left, top: pos.top, width: 180 }}
        >
          {LOCALE_KEYS.map(k => (
            <button
              key={k}
              role="menuitemradio"
              aria-checked={k === locale}
              className={`locale-item${k === locale ? ' active' : ''}`}
              onClick={() => { setLocale(k); setOpen(false) }}
            >
              <span className="locale-flag">{LOCALES[k].flag}</span>
              <span className="locale-text">
                <span className="locale-native">{LOCALES[k].native}</span>
                <span className="locale-name">{LOCALES[k].name}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function Dashboard({ data, modelNames, granularity, onSelectProject, inProjectView }: {
  data: OverviewResponse
  modelNames: string[]
  granularity: Granularity
  onSelectProject: (p: string) => void
  inProjectView: boolean
}) {
  const t = useT()
  const dl = useDateLocale()
  const activeBuckets = data.series.filter(r => Number(r.calls) > 0).length
  // Average over ACTIVE periods only — a $78 spend across 2 active days means $39/day of real usage,
  // not $2.61 smeared across 30 calendar days. Matches user intuition and aligns with the "Active X / Y" KPI next door.
  const avgPerBucket = activeBuckets > 0 ? data.totals.cost / activeBuckets : 0
  const avgCallsPerBucket = activeBuckets > 0 ? data.totals.calls / activeBuckets : 0

  const series = data.series.map(row => ({
    ...row,
    _label: formatBucket(row.bucket as string, granularity, dl),
  }))
  const hasAnyData = data.totals.calls > 0
  const hasTokenData = data.totals.inputTokens + data.totals.outputTokens + data.totals.cacheRead + data.totals.cacheWrite > 0

  return (
    <>
      <div className="kpis">
        <KpiGroup title={t('kpi.spend')}>
          <KpiMetric label={t('kpi.total')} value={fmtCurrency(data.totals.cost)} sub={`${fmtInt(data.totals.calls)} ${t('kpi.apiCalls')}`} />
          <KpiMetric label={`${t('kpi.avg')} / ${t('controls.' + granularity as any)}`} value={fmtCurrency(avgPerBucket)} sub={`${fmtInt(avgCallsPerBucket)} ${t('kpi.calls')}`} />
        </KpiGroup>
        <KpiGroup title={t('kpi.tokens')}>
          <KpiMetric label={t('kpi.input')} value={fmtTokens(data.totals.inputTokens)} />
          <KpiMetric label={t('kpi.output')} value={fmtTokens(data.totals.outputTokens)} />
        </KpiGroup>
        <KpiGroup title={t('kpi.cache')}>
          <KpiMetric label={t('kpi.read')} value={fmtTokens(data.totals.cacheRead)} />
          <KpiMetric label={t('kpi.write')} value={fmtTokens(data.totals.cacheWrite)} />
        </KpiGroup>
        <KpiGroup title={t('kpi.scope')}>
          {!inProjectView && <KpiMetric label={t('kpi.projects')} value={String(data.totals.projects)} />}
          <KpiMetric label={`${t('kpi.active')} ${t(granularity === 'day' ? 'summary.days' : granularity === 'week' ? 'summary.weeks' : 'summary.months')}`} value={`${activeBuckets} / ${data.frame.bucketCount}`} />
        </KpiGroup>
      </div>

      {!inProjectView && (
        <CostByProjectPanel
          series={series}
          topProjects={data.topProjects ?? []}
          otherProjects={data.otherProjects ?? { count: 0, cost: 0 }}
          granularity={granularity}
          hasData={hasAnyData}
          onSelectProject={onSelectProject}
        />
      )}

      <div className="panel" style={{ marginBottom: 14 }}>
        <PanelHeader
          title={t('panel.costByModel.title')}
          sub={t(granularity === 'day' ? 'panel.costByModel.subDay' : granularity === 'week' ? 'panel.costByModel.subWeek' : 'panel.costByModel.subMonth')}
          help={t('panel.costByModel.help')}
        />
        {hasAnyData ? (
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }} barCategoryGap="15%">
              <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="_label" tickLine={false} axisLine={{ stroke: 'var(--grid)' }} interval="preserveStartEnd" />
              <YAxis tickLine={false} axisLine={{ stroke: 'var(--grid)' }} tickFormatter={v => `$${v}`} width={70} />
              <Tooltip content={<SeriesTooltip />} cursor={{ fill: 'var(--hover)' }} animationDuration={0} isAnimationActive={false} />
              <Legend wrapperStyle={{ paddingTop: 8 }} iconType="square" />
              {modelNames.map((m, i) => {
                const isLast = i === modelNames.length - 1
                return (
                  <Bar
                    key={m}
                    dataKey={`model:${m}`}
                    name={m}
                    stackId="cost"
                    fill={COLORS[i % COLORS.length]}
                    radius={isLast ? [3, 3, 0, 0] : 0}
                    isAnimationActive={false}
                  />
                )
              })}
            </BarChart>
          </ResponsiveContainer>
        ) : (<ChartEmpty height={340} />)}
      </div>

      <TokensPanel series={series} granularity={granularity} hasData={hasTokenData} />

      <div className="panel" style={{ marginBottom: 14 }}>
        <PanelHeader
          title={t('panel.calls.title')}
          sub={t(granularity === 'day' ? 'panel.calls.subDay' : granularity === 'week' ? 'panel.calls.subWeek' : 'panel.calls.subMonth')}
          help={t('panel.calls.help')}
        />
        {hasAnyData ? (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }} barCategoryGap="15%">
              <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="_label" tickLine={false} axisLine={{ stroke: 'var(--grid)' }} interval="preserveStartEnd" />
              <YAxis tickLine={false} axisLine={{ stroke: 'var(--grid)' }} tickFormatter={fmtInt} width={60} />
              <Tooltip content={<CallsTooltip />} cursor={{ fill: 'var(--hover)' }} animationDuration={0} isAnimationActive={false} />
              <Bar dataKey="calls" fill="var(--chart-2)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        ) : (<ChartEmpty height={180} />)}
      </div>

      <ModelsPanel data={data} />

      <div className="grid col-2">
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title-row">
              <h3 style={{ margin: 0 }}>{t('panel.activity.title')}</h3>
              <HelpTip>{t('panel.activity.help')}</HelpTip>
            </div>
          </div>
          {data.categories.length === 0 ? <ChartEmpty height={280} /> : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.categories} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={v => `$${v}`} tickLine={false} axisLine={{ stroke: 'var(--grid)' }} />
                <YAxis type="category" dataKey="name" tickLine={false} axisLine={{ stroke: 'var(--grid)' }} width={110} />
                <Tooltip content={<RowTooltip />} cursor={{ fill: 'var(--hover)' }} animationDuration={0} isAnimationActive={false} />
                <Bar dataKey="cost" fill="var(--chart-1)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {!inProjectView && (
          <div className="panel">
            <div className="panel-head">
              <div className="panel-title-row">
                <h3 style={{ margin: 0 }}>{t('panel.topProjects.title')}</h3>
                <HelpTip>{t('panel.topProjects.help')}</HelpTip>
              </div>
            </div>
            {data.projects.length === 0 ? <ChartEmpty height={200} /> : (
            <table className="breakdown breakdown-projects">
              <colgroup>
                <col />
                <col style={{ width: 80 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 32 }} />
              </colgroup>
              <thead><tr><th>{t('panel.topProjects.colProject')}</th><th className="num">{t('panel.topProjects.colCalls')}</th><th className="num">{t('panel.topProjects.colCost')}</th><th /></tr></thead>
              <tbody>
                {data.projects.slice(0, 12).map(p => (
                  <tr key={p.name} className="clickable">
                    <td className="project-cell">
                      {p.id && (
                        <a
                          className="row-stretch-link"
                          href={hrefFor({ name: 'project', id: p.id })}
                          aria-label={p.label}
                        />
                      )}
                      <span className="project-name">
                        {p.favorite && <span className="fav-star" aria-hidden="true">★</span>}
                        <span className="project-name-wrap">
                          <MidEllipsis text={p.label} />
                        </span>
                      </span>
                    </td>
                    <td className="num">{fmtInt(p.calls)}</td>
                    <td className="num">{fmtCurrency(p.cost)}</td>
                    <td className="open-arrow-cell"><span className="open-arrow">→</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>
        )}
      </div>
    </>
  )
}

type TokenView = 'all' | 'io' | 'cache'

function CostByProjectPanel({
  series, topProjects, otherProjects, granularity, hasData, onSelectProject,
}: {
  series: Array<Record<string, number | string>>
  topProjects: OverviewResponse['topProjects']
  otherProjects: OverviewResponse['otherProjects']
  granularity: Granularity
  hasData: boolean
  onSelectProject: (key: string) => void
}) {
  const t = useT()
  // Assign each top project a stable color from the palette; "Other" is neutral dim.
  const entries = topProjects.map((p, i) => ({
    dataKey: `project:${p.key}`,
    label: p.label,
    projectKey: p.key,
    projectId: p.id,
    cost: p.cost,
    color: COLORS[i % COLORS.length],
  }))
  if (otherProjects.count > 0) {
    entries.push({
      dataKey: 'project:__other',
      label: t('panel.costByProject.other'),
      projectKey: '',
      projectId: null,
      cost: otherProjects.cost,
      color: 'var(--text-dim)',
    })
  }

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <PanelHeader
        title={t('panel.costByProject.title')}
        sub={t(granularity === 'day' ? 'panel.costByProject.subDay' : granularity === 'week' ? 'panel.costByProject.subWeek' : 'panel.costByProject.subMonth')}
        help={t('panel.costByProject.help')}
      />
      {!hasData || entries.length === 0 ? (
        <ChartEmpty height={340} />
      ) : (
        <>
          <div className="activity-pills" role="list">
            {entries.map(e => {
              const isOther = e.dataKey === 'project:__other'
              const clickable = !isOther && !!e.projectKey
              const shortLabel = isOther
                ? t('panel.costByProject.other')
                : compactProjectLabel(e.label)
              const fullTitle = isOther
                ? t('panel.costByProject.otherWith', { count: otherProjects.count })
                : `${e.label} · ${fmtCurrency(e.cost)}`
              return (
                <button
                  key={e.dataKey}
                  role="listitem"
                  className={`activity-pill${clickable ? ' clickable' : ''}`}
                  onClick={clickable ? () => onSelectProject(e.projectKey) : undefined}
                  disabled={!clickable}
                  title={fullTitle}
                >
                  <span className="pill-dot" style={{ background: e.color }} />
                  <span className="pill-label">{shortLabel}</span>
                </button>
              )
            })}
          </div>
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }} barCategoryGap="15%">
              <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="_label" tickLine={false} axisLine={{ stroke: 'var(--grid)' }} interval="preserveStartEnd" />
              <YAxis tickLine={false} axisLine={{ stroke: 'var(--grid)' }} tickFormatter={v => `$${v}`} width={70} />
              <Tooltip content={<ProjectSeriesTooltip entries={entries} />} cursor={{ fill: 'var(--hover)' }} animationDuration={0} isAnimationActive={false} />
              {entries.map((e, i) => {
                const isLast = i === entries.length - 1
                return (
                  <Bar
                    key={e.dataKey}
                    dataKey={e.dataKey}
                    name={e.label}
                    stackId="cost"
                    fill={e.color}
                    radius={isLast ? [3, 3, 0, 0] : 0}
                    isAnimationActive={false}
                  />
                )
              })}
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  )
}

function ProjectSeriesTooltip({ active, payload, label, entries }: TTProps & { entries: Array<{ dataKey: string; label: string; color: string }> }) {
  if (!active || !payload || payload.length === 0) return null
  const items = payload.filter(p => p.value > 0)
  const total = items.reduce((s, p) => s + (p.value ?? 0), 0)
  const byKey = new Map(entries.map(e => [e.dataKey, e]))
  return (
    <div className="tooltip">
      <div className="tt-title">{label}</div>
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
  )
}

function TokensPanel({ series, granularity: _g, hasData }: { series: Array<Record<string, number | string>>; granularity: Granularity; hasData: boolean }) {
  const t = useT()
  const [view, setView] = useState<TokenView>('all')
  const showIO = view === 'all' || view === 'io'
  const showCache = view === 'all' || view === 'cache'
  const bars: Array<{ key: string; name: string; color: string }> = []
  if (showCache) {
    bars.push({ key: 'cacheRead', name: `${t('kpi.cache')} ${t('kpi.read').toLowerCase()}`, color: 'var(--chart-2)' })
    bars.push({ key: 'cacheWrite', name: `${t('kpi.cache')} ${t('kpi.write').toLowerCase()}`, color: 'var(--chart-4)' })
  }
  if (showIO) {
    bars.push({ key: 'outputTokens', name: t('kpi.output'), color: 'var(--chart-1)' })
    bars.push({ key: 'inputTokens', name: t('kpi.input'), color: 'var(--chart-3)' })
  }
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-head">
        <div>
          <div className="panel-title-row">
            <h3 style={{ margin: 0 }}>{t('panel.tokens.title')}</h3>
            <HelpTip>
              {t('panel.tokens.help.intro')} <strong>{t('kpi.input')}/{t('kpi.output')}</strong> — {t('panel.tokens.help.io')} <strong>{t('kpi.cache')}</strong> — {t('panel.tokens.help.cache')} {t('panel.tokens.help.tip')}
            </HelpTip>
          </div>
          <span className="panel-sub">{t('panel.tokens.sub')}</span>
        </div>
        <div className="group" style={{ gap: 5 }}>
          <button className={`chip${view === 'all' ? ' active' : ''}`} onClick={() => setView('all')}>{t('panel.tokens.both')}</button>
          <button className={`chip${view === 'io' ? ' active' : ''}`} onClick={() => setView('io')}>{t('panel.tokens.ioOnly')}</button>
          <button className={`chip${view === 'cache' ? ' active' : ''}`} onClick={() => setView('cache')}>{t('panel.tokens.cacheOnly')}</button>
        </div>
      </div>
      {hasData ? (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }} barCategoryGap="15%">
            <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="_label" tickLine={false} axisLine={{ stroke: 'var(--grid)' }} interval="preserveStartEnd" />
            <YAxis tickLine={false} axisLine={{ stroke: 'var(--grid)' }} tickFormatter={fmtTokens} width={60} />
            <Tooltip content={<TokenTooltip />} cursor={{ fill: 'var(--hover)' }} animationDuration={0} isAnimationActive={false} />
            <Legend wrapperStyle={{ paddingTop: 8 }} iconType="square" />
            {bars.map((b, i) => (
              <Bar
                key={b.key}
                dataKey={b.key}
                name={b.name}
                stackId="t"
                fill={b.color}
                radius={i === bars.length - 1 ? [3, 3, 0, 0] : 0}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : (<ChartEmpty height={260} />)}
    </div>
  )
}

function ModelsPanel({ data }: { data: OverviewResponse }) {
  const t = useT()
  const totalCost = data.totals.cost
  const totalCalls = data.totals.calls
  const maxShare = data.models[0]?.cost ?? 0
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <PanelHeader
        title={t('panel.models.title')}
        sub={t('panel.models.subFmt', { count: data.models.length, calls: fmtInt(totalCalls), cost: fmtCurrency(totalCost) })}
        help={t('panel.models.help')}
      />
      {data.models.length === 0 ? <ChartEmpty height={160} /> : (
      <table className="models">
        <colgroup>
          <col style={{ width: '18%' }} />
          <col style={{ width: '24%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '12%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>{t('panel.models.colModel')}</th>
            <th>{t('panel.models.colShare')}</th>
            <th>{t('panel.models.colCalls')}</th>
            <th>{t('panel.models.colInput')}</th>
            <th>{t('panel.models.colOutput')}</th>
            <th>{t('panel.models.colCacheR')}</th>
            <th>{t('panel.models.colCacheW')}</th>
            <th>{t('panel.models.colCost')}</th>
          </tr>
        </thead>
        <tbody>
          {data.models.map((m, i) => {
            const share = totalCost > 0 ? (m.cost / totalCost) * 100 : 0
            const barWidth = maxShare > 0 ? (m.cost / maxShare) * 100 : 0
            const color = `var(--chart-${(i % 10) + 1})`
            return (
              <tr key={m.name}>
                <td>
                  <span className="model-cell">
                    <span className="swatch" style={{ background: color }} />
                    {m.name}
                  </span>
                </td>
                <td className="share-cell">
                  <div className="share-bar">
                    <div className="share-fill" style={{ width: `${barWidth}%`, background: color }} />
                    <span className="share-label">{share.toFixed(1)}%</span>
                  </div>
                </td>
                <td>{fmtInt(m.calls)}</td>
                <td>{fmtTokens(m.inputTokens)}</td>
                <td>{fmtTokens(m.outputTokens)}</td>
                <td>{fmtTokens(m.cacheRead)}</td>
                <td>{fmtTokens(m.cacheWrite)}</td>
                <td style={{ fontWeight: 600 }}>{fmtCurrency(m.cost)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      )}
    </div>
  )
}

function KpiGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="kpi-group">
      <div className="kpi-group-title">{title}</div>
      <div className="kpi-group-body">{children}</div>
    </div>
  )
}

function KpiMetric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi-metric">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

type TTProps = { active?: boolean; payload?: any[]; label?: string }

function SeriesTooltip({ active, payload, label }: TTProps) {
  if (!active || !payload || payload.length === 0) return null
  const items = payload.filter(p => p.dataKey && String(p.dataKey).startsWith('model:') && p.value > 0)
  const totalCost = items.reduce((s, p) => s + (p.value ?? 0), 0)
  return (
    <div className="tooltip">
      <div className="tt-title">{label}</div>
      <div className="tt-row"><span>Total</span><span className="tt-val">{fmtCurrency(totalCost)}</span></div>
      <div style={{ height: 6, borderTop: '1px solid var(--border)', marginTop: 4 }} />
      {items.sort((a, b) => b.value - a.value).map(p => (
        <div className="tt-row" key={p.dataKey}>
          <span><span className="swatch" style={{ background: p.color }} />{String(p.dataKey).replace('model:', '')}</span>
          <span className="tt-val">{fmtCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

function CallsTooltip({ active, payload, label }: TTProps) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="tooltip">
      <div className="tt-title">{label}</div>
      <div className="tt-row"><span>API calls</span><span className="tt-val">{fmtInt(payload[0].value)}</span></div>
    </div>
  )
}

function TokenTooltip({ active, payload, label }: TTProps) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="tooltip">
      <div className="tt-title">{label}</div>
      {payload.map(p => (
        <div className="tt-row" key={p.dataKey}>
          <span><span className="swatch" style={{ background: p.color }} />{p.name}</span>
          <span className="tt-val">{fmtTokens(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

function RowTooltip({ active, payload }: TTProps) {
  if (!active || !payload || payload.length === 0) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div className="tooltip">
      <div className="tt-title">{d.name}</div>
      <div className="tt-row"><span>Cost</span><span className="tt-val">{fmtCurrency(d.cost)}</span></div>
      {d.calls !== undefined && <div className="tt-row"><span>Calls</span><span className="tt-val">{fmtInt(d.calls)}</span></div>}
    </div>
  )
}
