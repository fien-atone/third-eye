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
 *  Two-speed cadence:
 *    - while server reports checking:true → 800 ms (catches the
 *      1.2 s spinner-flicker window reliably);
 *    - otherwise → 5 s.
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
const SLOW_INTERVAL_MS = 5_000
const ERROR_BACKOFF_MS = 10_000

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
    schedule(data.checking ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS)
  } catch {
    schedule(ERROR_BACKOFF_MS)
  } finally {
    inFlight = false
  }
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
