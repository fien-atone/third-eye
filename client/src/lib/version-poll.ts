/** Singleton version-check poller, with cross-tab leader election.
 *
 *  Boots once from main.tsx via startVersionPoll(). At most ONE tab
 *  in the browser actually polls /api/version at a time — the
 *  others sit silent and receive cached results via BroadcastChannel.
 *  When the leader tab closes, a Web Lock is released and the next
 *  waiting tab promotes itself.
 *
 *  ──────────  WHY THIS MUCH MACHINERY  ──────────
 *
 *  Without coordination:
 *    - Multiple tabs of the dashboard each spin their own polling
 *      timer. With N tabs and a 1 h cadence, that's still N requests
 *      per hour — not a load problem, but an obvious correctness
 *      smell. Real users WILL open the dashboard in two tabs.
 *
 *  Without window-scoped state:
 *    - Vite HMR can replay this module's top-level code more than
 *      once per page session (proven empirically — same Math-random
 *      ID printed twice within seconds). Module-scoped `started`
 *      flags get bypassed, multiple timers stack, request count
 *      goes 2-3x.
 *
 *  Both fixed here:
 *    - State on `window.__thirdEyeVersionPoll`: shared across module
 *      instances within the same tab. Second module-replay sees
 *      `started=true` and short-circuits.
 *    - Web Lock: shared across tabs of the same origin in the same
 *      browser. Only one tab holds it at a time; followers wait.
 *    - BroadcastChannel: leader broadcasts every cache update so
 *      followers' QueryClient stays in sync without making their
 *      own requests.
 *
 *  ──────────  CADENCE  ──────────
 *
 *  Wake POST_POLL_BUFFER_MS AFTER server's nextCheckAt so the
 *  response carries a fresh server poll. Waking BEFORE used to
 *  produce a tight loop: stale nextCheckAt → msUntilNext ≈ 0 →
 *  floored to MIN_DELAY → tick again with still-stale data → 3-4
 *  bursts per cycle. Capped at 5 min as a safety net for stale
 *  nextCheckAt across server restarts; floored at MIN_DELAY (5 s)
 *  so a slightly-past timestamp never thrashes.
 *
 *  ──────────  SPINNER UX  ──────────
 *
 *  Pure client-side affordance for "request in flight". When tick()
 *  starts, we synthesize checking:true into the cached version data
 *  so the header dot flips to the spinner. After the response
 *  settles AND a minimum visible time elapses (so a fast network
 *  roundtrip doesn't produce an invisible 30 ms flicker), we set
 *  checking:false and write the fresh data. Broadcast both states
 *  so other tabs animate the same way.
 *
 *  pokeVersionPoll() jumps the queue: the next tick fires now,
 *  cancelling the pending one. Used after the user saves Updates
 *  settings — the server schedules a fresh poll in ~1 s, and this
 *  brings the UI in line within a single round-trip. If the saving
 *  tab isn't the leader, the poke is broadcast to the leader tab
 *  via BroadcastChannel. */

import type { QueryClient } from '@tanstack/react-query'
import { apiGet } from '../api'
import type { VersionResponse } from '../types'

const ERROR_BACKOFF_MS = 10_000
const FALLBACK_INTERVAL_MS = 5 * 60_000
const POST_POLL_BUFFER_MS = 500
const MIN_DELAY_MS = 5_000
const MIN_SPINNER_MS = 1200
const INITIAL_DELAY_MS = 1_500
const LOCK_NAME = 'third-eye-version-poll-leader'
const CHANNEL_NAME = 'third-eye-version-poll'

type PollState = {
  started: boolean
  isLeader: boolean
  timer: ReturnType<typeof setTimeout> | null
  qc: QueryClient | null
  inFlight: boolean
}
declare global {
  interface Window { __thirdEyeVersionPoll?: PollState }
}
const state: PollState = (window.__thirdEyeVersionPoll ??= {
  started: false,
  isLeader: false,
  timer: null,
  qc: null,
  inFlight: false,
})

type CrossTabMsg =
  | { type: 'version-data'; payload: VersionResponse }
  | { type: 'poke' }
  | { type: 'hello' }

let channel: BroadcastChannel | null = null
function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME)
  return channel
}

function schedule(ms: number) {
  if (state.timer) clearTimeout(state.timer)
  state.timer = setTimeout(tick, ms)
}

async function tick() {
  if (!state.qc) return
  if (state.inFlight) return
  state.inFlight = true

  const qc = state.qc
  const ch = getChannel()
  const previous = qc.getQueryData<VersionResponse>(['version'])
  const inflight: VersionResponse = {
    latest: previous?.latest ?? null,
    latestUrl: previous?.latestUrl ?? null,
    latestName: previous?.latestName ?? null,
    latestPublishedAt: previous?.latestPublishedAt ?? null,
    lastCheckedAt: previous?.lastCheckedAt ?? null,
    nextCheckAt: previous?.nextCheckAt ?? null,
    checking: true,
  }
  qc.setQueryData<VersionResponse>(['version'], inflight)
  ch?.postMessage({ type: 'version-data', payload: inflight } satisfies CrossTabMsg)

  const startedAt = Date.now()
  try {
    const data = await apiGet<VersionResponse>('/api/version')
    const elapsed = Date.now() - startedAt
    if (elapsed < MIN_SPINNER_MS) {
      await new Promise<void>(r => setTimeout(r, MIN_SPINNER_MS - elapsed))
    }
    const next: VersionResponse = { ...data, checking: false }
    qc.setQueryData<VersionResponse>(['version'], next)
    ch?.postMessage({ type: 'version-data', payload: next } satisfies CrossTabMsg)
    schedule(computeNextDelay(data))
  } catch {
    if (previous) {
      const restored = { ...previous, checking: false }
      qc.setQueryData<VersionResponse>(['version'], restored)
      ch?.postMessage({ type: 'version-data', payload: restored } satisfies CrossTabMsg)
    }
    schedule(ERROR_BACKOFF_MS)
  } finally {
    state.inFlight = false
  }
}

function computeNextDelay(data: VersionResponse): number {
  if (!data.nextCheckAt) return FALLBACK_INTERVAL_MS
  const msUntilNext = new Date(data.nextCheckAt).getTime() - Date.now() + POST_POLL_BUFFER_MS
  return Math.min(FALLBACK_INTERVAL_MS, Math.max(MIN_DELAY_MS, msUntilNext))
}

/** Idempotent boot. Call once from main.tsx before the first render.
 *
 *  Subscribes to the cross-tab BroadcastChannel either way (so a
 *  follower receives leader broadcasts, and a leader notices when
 *  another tab posts a `hello` or a `poke`). Then attempts to
 *  acquire the leader lock — if granted, kicks off the polling loop
 *  with INITIAL_DELAY_MS; if not, sits silent and waits. When the
 *  current leader's tab closes, the lock auto-releases and one of
 *  the waiting tabs gets the callback fired. */
export function startVersionPoll(client: QueryClient) {
  if (state.started) return
  state.started = true
  state.qc = client

  const ch = getChannel()
  if (ch) {
    ch.onmessage = (e: MessageEvent<CrossTabMsg>) => {
      const msg = e.data
      if (!msg || !state.qc) return
      if (msg.type === 'version-data') {
        // Mirror the leader's cache update locally. This is how the
        // header indicator stays in sync across tabs without each
        // tab making its own /api/version request.
        state.qc.setQueryData<VersionResponse>(['version'], msg.payload)
      } else if (msg.type === 'poke' && state.isLeader) {
        // Settings was just saved in another tab; jump our queue.
        schedule(0)
      } else if (msg.type === 'hello' && state.isLeader) {
        // A new tab opened. Re-broadcast our latest cached data so
        // they don't have to wait until the next poll for content.
        const data = state.qc.getQueryData<VersionResponse>(['version'])
        if (data) ch.postMessage({ type: 'version-data', payload: data } satisfies CrossTabMsg)
      }
    }
    // Announce ourselves to the existing leader (if any), so we get
    // the latest cached payload immediately instead of waiting for
    // the next poll cycle.
    ch.postMessage({ type: 'hello' } satisfies CrossTabMsg)
  }

  // Try to become leader. The lock is held for the lifetime of this
  // tab — the inner promise never resolves, so the callback runs
  // until the tab unloads. Followers' callbacks queue and only fire
  // when the current leader releases (i.e. its tab closes).
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    void navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, async () => {
      state.isLeader = true
      schedule(INITIAL_DELAY_MS)
      await new Promise<void>(() => {
        // Intentionally never resolves. The lock is released when
        // the tab unloads, which the browser does for us — no
        // explicit cleanup needed.
      })
    })
  } else {
    // No Web Locks support (very old browser). Each tab polls
    // independently. Better than nothing.
    state.isLeader = true
    schedule(INITIAL_DELAY_MS)
  }
}

/** Refetch right now. If we're the leader, fire immediately. If
 *  we're a follower, broadcast the request — the actual leader will
 *  pick it up off the channel and fire its tick. Either way the
 *  whole tab group ends up showing fresh data within ~1 RTT. */
export function pokeVersionPoll() {
  if (!state.started) return
  getChannel()?.postMessage({ type: 'poke' } satisfies CrossTabMsg)
  if (state.isLeader) schedule(0)
}
