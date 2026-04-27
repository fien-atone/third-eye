/** Singleton version-check poller.
 *
 *  Lives outside the React tree so it's bulletproof against StrictMode
 *  dev double-mount and any consumer accidentally adding another
 *  observer with the same queryKey.
 *
 *  Boots once from main.tsx via startVersionPoll(). Owns the only
 *  /api/version timer in the app. Pushes results into the
 *  QueryClient cache so any number of useQuery(['version']) calls
 *  observe the same data with zero polling of their own.
 *
 *  ──────────  STATE LIVES ON `window`  ──────────
 *  We attach state to window.__thirdEyeVersionPoll instead of holding
 *  it in module scope. Vite HMR can replay this module's top-level
 *  code more than once per page session (we proved it with a Math-
 *  random module ID — same ID printed twice within seconds). With
 *  module-scoped `started`, each replay launched its own timer and
 *  we ended up with 2-3 ticks per cycle. Window-scoped state means
 *  every module instance reads the same flag and the second one
 *  short-circuits cleanly.
 *
 *  Cadence: sleep until the server's next scheduled poll
 *  (data.nextCheckAt), minus a 500 ms head-start. That's the only
 *  moment server-side data can change, so polling more often is
 *  pure waste. With a default 6 h cadence the steady-state cost is
 *  one /api/version per 6 h, not one per 5 s.
 *
 *  Spinner UX: the spinner is purely a CLIENT-side affordance for
 *  "request in flight". When tick() starts, we synthesize
 *  checking:true into the cached version data so the header dot
 *  flips to the spinner. After the response settles AND a minimum
 *  visible time elapses (so a fast network roundtrip doesn't
 *  produce a 30 ms flicker the user can't see), we set
 *  checking:false and write the fresh data. One request per cycle.
 *
 *  Capped at 5 min to defend against stale nextCheckAt across
 *  server restarts (UI catches up within minutes, not hours).
 *  On error we back off to 10 s so a transient network blip doesn't
 *  hammer the endpoint.
 *
 *  pokeVersionPoll() jumps the queue: the next tick fires now,
 *  cancelling the pending one. Used right after the user saves the
 *  Updates settings — the server schedules a fresh poll within 1 s,
 *  and we want the UI to reflect it without a 5 s lag. */

import type { QueryClient } from '@tanstack/react-query'
import { apiGet } from '../api'
import type { VersionResponse } from '../types'

const ERROR_BACKOFF_MS = 10_000
const FALLBACK_INTERVAL_MS = 5 * 60_000
const HEAD_START_MS = 500
const MIN_DELAY_MS = 250
const MIN_SPINNER_MS = 1200
const INITIAL_DELAY_MS = 1_500

type PollState = {
  started: boolean
  timer: ReturnType<typeof setTimeout> | null
  qc: QueryClient | null
  inFlight: boolean
}
declare global {
  interface Window { __thirdEyeVersionPoll?: PollState }
}
const state: PollState = (window.__thirdEyeVersionPoll ??= {
  started: false,
  timer: null,
  qc: null,
  inFlight: false,
})

function schedule(ms: number) {
  if (state.timer) clearTimeout(state.timer)
  state.timer = setTimeout(tick, ms)
}

async function tick() {
  if (!state.qc) return
  // Belt + braces: shouldn't be reachable since we always clear the
  // timer before scheduling, but if a poke races a scheduled tick
  // we'd rather skip than double-fire.
  if (state.inFlight) return
  state.inFlight = true

  // Synthetic checking:true — flip the header dot to a spinner
  // BEFORE the request leaves the client, so the user sees activity
  // immediately on slow networks too. We merge into existing data so
  // latest/url/etc don't blink to undefined.
  const qc = state.qc
  const previous = qc.getQueryData<VersionResponse>(['version'])
  qc.setQueryData<VersionResponse>(['version'], {
    latest: previous?.latest ?? null,
    latestUrl: previous?.latestUrl ?? null,
    latestName: previous?.latestName ?? null,
    latestPublishedAt: previous?.latestPublishedAt ?? null,
    lastCheckedAt: previous?.lastCheckedAt ?? null,
    nextCheckAt: previous?.nextCheckAt ?? null,
    checking: true,
  })

  const startedAt = Date.now()
  try {
    const data = await apiGet<VersionResponse>('/api/version')
    // Hold the spinner for a minimum visible duration — on a LAN
    // the round-trip is 20–50 ms, way too fast for the eye.
    const elapsed = Date.now() - startedAt
    if (elapsed < MIN_SPINNER_MS) {
      await new Promise<void>(r => setTimeout(r, MIN_SPINNER_MS - elapsed))
    }
    qc.setQueryData<VersionResponse>(['version'], { ...data, checking: false })
    schedule(computeNextDelay(data))
  } catch {
    if (previous) qc.setQueryData<VersionResponse>(['version'], { ...previous, checking: false })
    schedule(ERROR_BACKOFF_MS)
  } finally {
    state.inFlight = false
  }
}

function computeNextDelay(data: VersionResponse): number {
  if (!data.nextCheckAt) return FALLBACK_INTERVAL_MS
  const msUntilNext = new Date(data.nextCheckAt).getTime() - Date.now() - HEAD_START_MS
  return Math.min(FALLBACK_INTERVAL_MS, Math.max(MIN_DELAY_MS, msUntilNext))
}

/** Idempotent boot. Call once from main.tsx before the first render.
 *  Window-scoped `state.started` means subsequent calls — including
 *  those from HMR module reloads — are guaranteed no-ops.
 *
 *  Initial tick is deferred by INITIAL_DELAY_MS so it doesn't fight
 *  with the rest of the page-load fetches (overview / projects /
 *  providers / layout). The badge renders immediately with the local
 *  version number; the indicator dot just waits a beat. */
export function startVersionPoll(client: QueryClient) {
  if (state.started) return
  state.started = true
  state.qc = client
  schedule(INITIAL_DELAY_MS)
}

/** Refetch right now, cancelling any pending tick. Used after the
 *  user saves Updates settings: the server schedules a fresh poll in
 *  ~1 s, and this brings the UI in line within a single round-trip. */
export function pokeVersionPoll() {
  if (!state.started) return
  schedule(0)
}
