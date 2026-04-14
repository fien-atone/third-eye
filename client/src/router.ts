import { useEffect, useState } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'project'; id: string }
  | { name: 'notfound' }

/** Any non-root pathname on a SPA is unknown — the server serves index.html for everything. */
function parse(): Route {
  const path = window.location.pathname
  if (path !== '/' && path !== '/index.html' && path !== '') {
    return { name: 'notfound' }
  }
  const hash = window.location.hash
  if (!hash || hash === '#' || hash === '#/') return { name: 'home' }
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

export function navigate(route: Route) {
  // If we're on a non-root path, replace to "/" first so the app state is consistent.
  if (window.location.pathname !== '/' && window.location.pathname !== '/index.html') {
    window.history.replaceState(null, '', '/' + (route.name === 'project' ? `#/project/${encodeURIComponent(route.id)}` : ''))
    window.dispatchEvent(new PopStateEvent('popstate'))
    return
  }
  let hash = ''
  if (route.name === 'project') hash = `#/project/${encodeURIComponent(route.id)}`
  else if (route.name === 'notfound') hash = '#/404'
  if (window.location.hash === hash) return
  window.location.hash = hash
}
