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
// Safety net when nextCheckAt is missing or way too far in the
// future. 5 min keeps a long-term server cadence visible while
// surviving stale timestamps after a server restart.
const FALLBACK_INTERVAL_MS = 5 * 60_000
const HEAD_START_MS = 500
// Floor on the schedule delay — a slightly-past nextCheckAt mustn't
// produce a busy-loop. 250 ms is small enough to feel "right after"
// but large enough to never thrash.
const MIN_DELAY_MS = 250
// Minimum spinner visibility so a 30 ms LAN roundtrip still produces
// a perceptible "checking…" beat in the header.
const MIN_SPINNER_MS = 1200

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
  // Belt + braces: shouldn't be reachable since we always clear the
  // timer before scheduling, but if a poke races a scheduled tick
  // we'd rather skip than double-fire.
  if (inFlight) return
  inFlight = true

  // Synthetic checking:true — flip the header dot to a spinner
  // BEFORE the request leaves the client, so the user sees activity
  // immediately on slow networks too. We merge into existing data so
  // latest/url/etc don't blink to undefined.
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
    // On error: drop the spinner, leave the previous data alone.
    if (previous) qc.setQueryData<VersionResponse>(['version'], { ...previous, checking: false })
    schedule(ERROR_BACKOFF_MS)
  } finally {
    inFlight = false
  }
}

function computeNextDelay(data: VersionResponse): number {
  // No nextCheckAt published (e.g. updates disabled, or server hasn't
  // scheduled a first poll yet) → stay quiet on the fallback cadence
  // and rely on pokeVersionPoll for explicit triggers.
  if (!data.nextCheckAt) return FALLBACK_INTERVAL_MS
  const msUntilNext = new Date(data.nextCheckAt).getTime() - Date.now() - HEAD_START_MS
  return Math.min(FALLBACK_INTERVAL_MS, Math.max(MIN_DELAY_MS, msUntilNext))
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
