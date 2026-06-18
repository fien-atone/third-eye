import { useEffect, useState } from 'react'
import type { Granularity } from './types'

/** Optional dashboard filter state persisted in the URL hash query.
 *  Carried by the routes that have a Dashboard-style filter UI
 *  (`home` and `project`) so refresh / back-forward / shared links
 *  preserve the user's date range, granularity and provider chips.
 *
 *  Validation lives in the parser below — invalid query values are
 *  simply dropped (URL stays in sync, but bad params get ignored). */
export type RouteFilters = {
  /** YYYY-MM-DD; the dashboard renders this as the range start (local TZ). */
  from?: string
  /** YYYY-MM-DD; range end (inclusive). */
  to?: string
  /** Bucket size for time-series widgets. */
  granularity?: Granularity
  /** Provider id list (codex, claude, …). Empty array means
   *  "all providers" — same convention as the API. */
  providers?: string[]
  /** Source alias filter (?source=). null/undefined = "all" (no
   *  filter); a non-empty string scopes every API call to the
   *  rows stamped with that alias. Identifiers (lowercase, dash /
   *  underscore) — server validates and 400s on unknown aliases. */
  source?: string | null
}

export type Route =
  | { name: 'home'; filters?: RouteFilters }
  | { name: 'projects' }
  | { name: 'project'; id: string; filters?: RouteFilters }
  | { name: 'today' }
  | { name: 'day'; date: string }   // YYYY-MM-DD
  | { name: 'notfound' }

/** Parse URL hash query (the part after `?`) into a RouteFilters or
 *  undefined when nothing valid was present. Lenient: unknown keys
 *  ignored; malformed values dropped without aborting the parse. */
function parseFilters(query: string): RouteFilters | undefined {
  if (!query) return undefined
  const params = new URLSearchParams(query)
  const out: RouteFilters = {}
  const from = params.get('from')
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) out.from = from
  const to = params.get('to')
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) out.to = to
  const g = params.get('g')
  if (g === 'hour' || g === 'day' || g === 'week' || g === 'month') out.granularity = g
  const p = params.get('p')
  if (p) {
    const list = p.split(',').map(s => s.trim()).filter(Boolean)
    if (list.length > 0) out.providers = list
  }
  // Source alias (?source=). Empty / 'all' / missing → null (no
  // filter). The server validates the alias and 400s on unknown
  // values; we just plumb the string through and let the chip
  // render the error on the next render. The regex mirrors the
  // server's `^[a-z0-9_-]{1,32}$` validation so a tampered URL
  // doesn't carry garbage into the client.
  const s = params.get('source')
  if (s) {
    const trimmed = s.trim()
    if (trimmed && trimmed !== 'all' && /^[a-z0-9_-]{1,32}$/.test(trimmed)) {
      out.source = trimmed
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Reverse of parseFilters. Always emits the leading `?` when the
 *  result is non-empty so callers can prepend without conditional
 *  string surgery. */
function serializeFilters(f: RouteFilters | undefined): string {
  if (!f) return ''
  const params = new URLSearchParams()
  if (f.from) params.set('from', f.from)
  if (f.to) params.set('to', f.to)
  if (f.granularity) params.set('g', f.granularity)
  if (f.providers && f.providers.length > 0) params.set('p', f.providers.join(','))
  if (f.source) params.set('source', f.source)
  const s = params.toString()
  return s ? `?${s}` : ''
}

/** Any non-root pathname on a SPA is unknown — the server serves index.html for everything. */
function parse(): Route {
  const path = window.location.pathname
  if (path !== '/' && path !== '/index.html' && path !== '') {
    return { name: 'notfound' }
  }
  const hash = window.location.hash
  if (!hash || hash === '#' || hash === '#/') return { name: 'home' }
  // Strip leading `#`, split into path + query so a route like
  // `#/project/abc?from=2026-04-01` parses cleanly.
  const stripped = hash.replace(/^#/, '')
  const qIdx = stripped.indexOf('?')
  const pathPart = qIdx === -1 ? stripped : stripped.slice(0, qIdx)
  const queryPart = qIdx === -1 ? '' : stripped.slice(qIdx + 1)
  const filters = parseFilters(queryPart)

  if (pathPart === '/' || pathPart === '') return { name: 'home', filters }
  if (pathPart === '/projects' || pathPart === '/projects/') return { name: 'projects' }
  if (pathPart === '/today' || pathPart === '/today/') return { name: 'today' }
  const dayM = pathPart.match(/^\/day\/(\d{4}-\d{2}-\d{2})$/)
  if (dayM) return { name: 'day', date: dayM[1] }
  const m = pathPart.match(/^\/project\/([^/]+)$/)
  if (m) return { name: 'project', id: decodeURIComponent(m[1]), filters }
  return { name: 'notfound' }
}

/** Synchronous read of the current route from `window.location`.
 *  Useful when the React-derived route is stale (e.g. inside a
 *  callback that just called `navigate` and wants to chain another
 *  update — useState updates are async, but the URL is already up
 *  to date because `replaceState`/`hash=` is synchronous). */
export function readRoute(): Route {
  return parse()
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse())
  useEffect(() => {
    const update = () => setRoute(parse())
    window.addEventListener('hashchange', update)
    window.addEventListener('popstate', update)
    return () => {
      window.removeEventListener('hashchange', update)
      window.removeEventListener('popstate', update)
    }
  }, [])
  return route
}

/** Build the href for a given route — used for `<a href>` links so that
 *  ⌘/Ctrl/middle-click open the project in a new tab natively. */
function hashFor(route: Route): string {
  if (route.name === 'project') {
    return `#/project/${encodeURIComponent(route.id)}${serializeFilters(route.filters)}`
  }
  if (route.name === 'projects') return '#/projects'
  if (route.name === 'today') return '#/today'
  if (route.name === 'day') return `#/day/${route.date}`
  if (route.name === 'notfound') return '#/404'
  // home — emit `#/` with optional filter query.
  return `#/${serializeFilters(route.filters)}`
}

export function hrefFor(route: Route): string {
  return hashFor(route) || '#/'
}

/** Push or replace the URL hash for a route.
 *
 *  `opts.replace` swaps `pushState` for `replaceState` — used when the
 *  change is a passive sync (e.g. user adjusted a date filter and we
 *  want the URL to reflect it without flooding browser history with
 *  a back-button entry per click). Default is push (real navigation).
 *
 *  When replace is on we manually dispatch a `hashchange` event because
 *  `replaceState` doesn't fire one — listeners (incl. useRoute) still
 *  need to re-parse the URL. */
export function navigate(route: Route, opts: { replace?: boolean } = {}) {
  const hash = hashFor(route)
  // If we're on a non-root path, replace to "/" first so the app state is consistent.
  if (window.location.pathname !== '/' && window.location.pathname !== '/index.html') {
    window.history.replaceState(null, '', '/' + hash)
    window.dispatchEvent(new PopStateEvent('popstate'))
    return
  }
  if (window.location.hash === hash) return
  if (opts.replace) {
    window.history.replaceState(null, '', hash || '#/')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    window.location.hash = hash
  }
}
