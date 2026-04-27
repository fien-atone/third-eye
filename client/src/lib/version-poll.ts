/** Singleton version-check poller.
 *
 *  Lives outside the React tree so it's bulletproof against:
 *    - StrictMode dev double-mount (each mount would otherwise spin
 *      its own refetch timer);
 *    - HMR retaining stale observers;
 *    - any consumer accidentally adding another observer with the
 *      same queryKey and getting a duplicate timer.
 *
 *  Boots once from main.tsx via startVersionPoll(). Owns the only
 *  /api/version timer in the app. Pushes results into the
 *  QueryClient cache so any number of useQuery(['version']) calls
 *  observe the same data with zero polling of their own.
 *
 *  Cadence:
 *    - while server reports checking:true → 800 ms (catches the
 *      1.2 s spinner-flicker window reliably);
 *    - otherwise → sleep until the server's next scheduled poll
 *      (data.nextCheckAt), minus a 500 ms head-start. That's the
 *      only moment server-side state can change, so polling more
 *      often is pure waste. With a default 6 h cadence the steady-
 *      state cost is one /api/version per 6 h, not one per 5 s.
 *  Capped at 5 min to defend against stale nextCheckAt across server
 *  restarts (UI catches up within minutes, not hours), floored at
 *  FAST_INTERVAL_MS so a slightly-past timestamp doesn't busy-loop.
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

const FAST_INTERVAL_MS = 800
const ERROR_BACKOFF_MS = 10_000
// Safety net when nextCheckAt is missing or way too far in the
// future. 5 min keeps a long-term server cadence visible while
// surviving stale timestamps after a server restart.
const FALLBACK_INTERVAL_MS = 5 * 60_000
const HEAD_START_MS = 500

let started = false
let timer: ReturnType<typeof setTimeout> | null = null
let qc: QueryClient | null = null
let inFlight = false

function schedule(ms: number) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(tick, ms)
}

async function tick() {
  if (!qc) return
  // Belt + braces: while a request is in flight, defer the next one
  // until it settles. Slow networks under DevTools throttling used
  // to stack three /api/version calls on top of each other.
  if (inFlight) {
    schedule(FAST_INTERVAL_MS)
    return
  }
  inFlight = true
  try {
    const data = await apiGet<VersionResponse>('/api/version')
    qc.setQueryData<VersionResponse>(['version'], data)
    schedule(computeNextDelay(data))
  } catch {
    schedule(ERROR_BACKOFF_MS)
  } finally {
    inFlight = false
  }
}

function computeNextDelay(data: VersionResponse): number {
  // Server is mid-poll → ride the 800 ms loop until it flips back.
  if (data.checking) return FAST_INTERVAL_MS
  // No nextCheckAt published (e.g. updates disabled, or server hasn't
  // scheduled a first poll yet) → stay quiet, rely on pokeVersionPoll
  // for explicit triggers.
  if (!data.nextCheckAt) return FALLBACK_INTERVAL_MS
  const msUntilNext = new Date(data.nextCheckAt).getTime() - Date.now() - HEAD_START_MS
  return Math.min(FALLBACK_INTERVAL_MS, Math.max(FAST_INTERVAL_MS, msUntilNext))
}

/** Idempotent boot. Call once from main.tsx before the first render.
 *  Subsequent calls (e.g. from HMR module reload) are no-ops — the
 *  original timer keeps running and the QueryClient reference stays
 *  the same instance shared across the app. */
export function startVersionPoll(client: QueryClient) {
  if (started) return
  started = true
  qc = client
  void tick()
}

/** Refetch right now, cancelling any pending tick. Used after the
 *  user saves Updates settings: the server schedules a fresh poll in
 *  ~1 s, and this brings the UI in line within a single round-trip. */
export function pokeVersionPoll() {
  if (!started) return
  schedule(0)
}

// HMR resilience: when Vite hot-replaces this module the new copy
// gets a fresh `started=false` and would launch a second timer
// alongside the original one (which keeps firing because its
// closure captured the old `timer` ref). dispose() runs against
// the OUTGOING module right before the new one takes over, giving
// us a chance to cancel the active timeout and release the started
// flag so the swap stays single-instance.
if (typeof import.meta !== 'undefined' && (import.meta as ImportMeta & { hot?: { dispose: (cb: () => void) => void } }).hot) {
  (import.meta as ImportMeta & { hot: { dispose: (cb: () => void) => void } }).hot.dispose(() => {
    if (timer) clearTimeout(timer)
    timer = null
    started = false
    qc = null
  })
}
