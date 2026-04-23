/** Projects screen — sortable / searchable / paginated table of all
 *  projects, with favorite toggling and inline label renaming. */

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useT, type T } from '../i18n'
import { useDateLocale, fmtCurrency, fmtInt } from '../lib/format'
import { apiGet, apiPatch } from '../api'
import { hrefFor } from '../router'
import { ChartEmpty, DateCell, MidEllipsis } from '../components/widgets-misc'
import type { ProjectInfo, ProjectsResponse } from '../types'

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
    showAutoHint: !!p.customLabel || (inAuto && !inLabel),
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

export function ProjectsPage() {
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

  // Optimistic-update mutation: apply the change to the cached projects
  // list *before* the server confirms, roll back on error, invalidate on
  // settle. Previously this relied on the invalidate-then-refetch round
  // trip to re-render the row, which made rapid favorite toggles and
  // rename saves look unresponsive (stale favorite star until refetch
  // lands; rename appearing to "not save" when the user expected an
  // immediate update). Mirrors TanStack Query's canonical optimistic
  // pattern — see https://tanstack.com/query/latest/docs/react/guides/optimistic-updates
  const patchMutation = useMutation<
    ProjectInfo,
    Error,
    { id: string; body: Partial<{ customLabel: string | null; favorite: boolean }> },
    { prev: ProjectsResponse | undefined }
  >({
    mutationFn: ({ id, body }) => apiPatch<ProjectInfo>(`/api/projects/${id}`, body),
    onMutate: async ({ id, body }) => {
      // Cancel in-flight refetches so they don't clobber our optimistic write.
      await qc.cancelQueries({ queryKey: ['projects'] })
      const prev = qc.getQueryData<ProjectsResponse>(['projects'])
      if (prev) {
        qc.setQueryData<ProjectsResponse>(['projects'], {
          ...prev,
          projects: prev.projects.map(p => {
            if (p.id !== id) return p
            const next: ProjectInfo = { ...p }
            if ('customLabel' in body) {
              next.customLabel = body.customLabel ?? null
              // `label` is the display name — keep it in sync so the row
              // renders the new text immediately without waiting for the
              // server's recomputed payload.
              next.label = body.customLabel ?? p.autoLabel
            }
            if ('favorite' in body && body.favorite !== undefined) {
              next.favorite = body.favorite
            }
            return next
          }),
        })
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      // Revert to the snapshot captured in onMutate if the server rejects.
      if (ctx?.prev) qc.setQueryData(['projects'], ctx.prev)
    },
    onSettled: () => {
      // Re-sync from the server regardless of outcome — catches any
      // server-side normalisation (e.g. label trimming, auto-derived
      // fallbacks) that our optimistic copy didn't replicate perfectly.
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
