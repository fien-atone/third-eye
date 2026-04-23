/** Centralised fetch wrapper + dashboard URL-param builder.
 *  Every API call in the client goes through these so cross-cutting
 *  concerns (error handling, future logging/retries, tzOffsetMin) live
 *  in one place. */

import { toInputDate } from './lib/format'
import type { Granularity } from './types'

// In dev we bypass Vite's proxy and hit the backend directly: Vite's
// http-proxy intermittently drops cold-burst requests (10s hangs that
// never reach the server), and HMR/WebSocket works fine without it.
// In prod the client is served by the same express process, so a relative
// path is correct.
const API_BASE = import.meta.env.DEV ? 'http://127.0.0.1:4317' : ''

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API_BASE + path, init)
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new Error(body || `HTTP ${r.status} on ${path}`)
  }
  return r.json() as Promise<T>
}

export const apiGet = <T,>(path: string) => api<T>(path)

export const apiPatch = <T,>(path: string, body: unknown) =>
  api<T>(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

export const apiPut = <T,>(path: string, body: unknown) =>
  api<T>(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

export const apiDelete = <T,>(path: string) =>
  api<T>(path, { method: 'DELETE' })

export const apiPost = <T,>(path: string, body?: unknown) =>
  api<T>(path, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

/** Standard URL params for /api/overview and /api/insights. Forces
 *  tzOffsetMin to be included — easy to forget when copy-pasting,
 *  and missing it makes server bucket calculations drift from the client's. */
export function dashboardParams(opts: {
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
