import { useEffect, useState } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'projects' }
  | { name: 'project'; id: string }
  | { name: 'today' }
  | { name: 'day'; date: string }   // YYYY-MM-DD
  | { name: 'notfound' }

/** Any non-root pathname on a SPA is unknown — the server serves index.html for everything. */
function parse(): Route {
  const path = window.location.pathname
  if (path !== '/' && path !== '/index.html' && path !== '') {
    return { name: 'notfound' }
  }
  const hash = window.location.hash
  if (!hash || hash === '#' || hash === '#/') return { name: 'home' }
  if (hash === '#/projects' || hash === '#/projects/') return { name: 'projects' }
  if (hash === '#/today' || hash === '#/today/') return { name: 'today' }
  const dayM = hash.match(/^#\/day\/(\d{4}-\d{2}-\d{2})$/)
  if (dayM) return { name: 'day', date: dayM[1] }
  const m = hash.match(/^#\/project\/([^/?&]+)$/)
  if (m) return { name: 'project', id: decodeURIComponent(m[1]) }
  return { name: 'notfound' }
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
  if (route.name === 'project') return `#/project/${encodeURIComponent(route.id)}`
  if (route.name === 'projects') return '#/projects'
  if (route.name === 'today') return '#/today'
  if (route.name === 'day') return `#/day/${route.date}`
  if (route.name === 'notfound') return '#/404'
  return ''
}

export function hrefFor(route: Route): string {
  return hashFor(route) || '#/'
}

export function navigate(route: Route) {
  const hash = hashFor(route)
  // If we're on a non-root path, replace to "/" first so the app state is consistent.
  if (window.location.pathname !== '/' && window.location.pathname !== '/index.html') {
    window.history.replaceState(null, '', '/' + hash)
    window.dispatchEvent(new PopStateEvent('popstate'))
    return
  }
  if (window.location.hash === hash) return
  window.location.hash = hash
}
