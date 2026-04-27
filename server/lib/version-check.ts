/** Background poll of the GitHub Releases API for the latest tag of
 *  this repo. Caches the result in memory so /api/version returns
 *  instantly without hitting GitHub on every request.
 *
 *  - First poll runs 1 s after import or settings change (so the user
 *    sees a fresh result right after enabling / changing frequency).
 *  - Subsequent polls every N seconds, where N comes from user
 *    settings (`updates.intervalSeconds`, default 6 h).
 *  - On error we keep the previous cache and log a single warning;
 *    the next poll retries.
 *  - Disabling updates stops the loop and clears the cache so the
 *    pill disappears on the next /api/version refetch.
 *  - The poller exposes `checking` + `lastCheckedAt` so the UI can
 *    show a "checking…" spinner while a request is in flight and an
 *    "up to date" checkmark when the cached result is fresh. */

import { getSettings } from './settings.ts'
import { envRead } from './env.ts'

// Which GitHub repo to poll for the "latest" release. Defaults to
// the canonical fien-atone/third-eye, but a fork or a custom mirror
// can override via THIRD_EYE_GITHUB_REPO=owner/name. NB: GitHub
// auth tokens are intentionally NOT supported — this dashboard
// ships to end users who set up their own self-host, and embedding
// or accepting a token would either leak a shared secret across
// installs or push every user to manage one. The 60 req/h
// unauthenticated limit is enough headroom for the ≥1 h cadence
// enforced server-side in production.
const REPO = envRead('THIRD_EYE_GITHUB_REPO') ?? 'fien-atone/third-eye'
const FIRST_POLL_DELAY_MS = 1_000
const REQUEST_TIMEOUT_MS = 8_000

export type LatestRelease = {
  tag: string         // 'v2.2.0'
  version: string     // '2.2.0'
  name: string        // 'v2.2.0 — Settings panel'
  htmlUrl: string
  publishedAt: string // ISO timestamp
} | null

let cache: LatestRelease = null
let lastError: string | null = null
let lastCheckedAt: string | null = null
let nextCheckAt: string | null = null
let checking = false
let intervalHandle: ReturnType<typeof setInterval> | null = null
let firstPollHandle: ReturnType<typeof setTimeout> | null = null
let started = false

export function getLatestRelease(): LatestRelease {
  return cache
}

/** Seed the cache directly without hitting GitHub. Used by the
 *  /api/_dev/seed-version endpoint to test outdated/up-to-date UI
 *  states locally and avoid burning the unauthenticated 60 req/h
 *  rate limit while iterating on the indicators. Gated to dev mode
 *  by the route handler — never exposed in production. */
export function seedLatestRelease(value: { version: string; name?: string; htmlUrl?: string; publishedAt?: string } | null) {
  if (value === null) {
    cache = null
    return
  }
  cache = {
    tag: `v${value.version.replace(/^v/, '')}`,
    version: value.version.replace(/^v/, ''),
    name: value.name ?? `v${value.version.replace(/^v/, '')}`,
    htmlUrl: value.htmlUrl ?? `https://github.com/fien-atone/third-eye/releases/tag/v${value.version}`,
    publishedAt: value.publishedAt ?? new Date().toISOString(),
  }
  lastCheckedAt = new Date().toISOString()
  lastError = null
}

export function getLastError(): string | null {
  return lastError
}

export function getCheckState(): { checking: boolean; lastCheckedAt: string | null; nextCheckAt: string | null } {
  return { checking, lastCheckedAt, nextCheckAt }
}

async function fetchLatest(): Promise<LatestRelease> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'Accept': 'application/vnd.github+json' },
      signal: ctrl.signal,
    })
    if (!r.ok) {
      lastError = `HTTP ${r.status}`
      return cache  // keep previous on error
    }
    const json = await r.json() as { tag_name?: string; name?: string; html_url?: string; published_at?: string }
    if (!json.tag_name) {
      lastError = 'no tag_name in response'
      return cache
    }
    lastError = null
    return {
      tag: json.tag_name,
      version: json.tag_name.replace(/^v/, ''),
      name: json.name ?? json.tag_name,
      htmlUrl: json.html_url ?? `https://github.com/${REPO}/releases/tag/${json.tag_name}`,
      publishedAt: json.published_at ?? new Date().toISOString(),
    }
  } catch (e) {
    lastError = (e as Error).message
    return cache
  } finally {
    clearTimeout(timer)
  }
}

async function poll() {
  // Server-side flag still tracked for diagnostics + the dev seed
  // endpoint, but the UI no longer reads it: the spinner is driven
  // entirely by the client's own in-flight state (see
  // client/src/lib/version-poll.ts). That removes the burst of
  // 2–3 client refetches per server poll cycle that we used to
  // need to "catch" the checking flicker.
  checking = true
  try {
    const next = await fetchLatest()
    if (next) cache = next
    lastCheckedAt = new Date().toISOString()
    if (lastError) {
      console.warn(`[version-check] failed: ${lastError}`)
    }
  } finally {
    checking = false
  }
}

function clearTimers() {
  if (firstPollHandle) { clearTimeout(firstPollHandle); firstPollHandle = null }
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null }
}

function scheduleLoop(intervalSeconds: number, firstPollMs: number) {
  clearTimers()
  const intervalMs = Math.max(1, intervalSeconds) * 1000
  // Publish the next-poll wallclock so the client can wake up just in
  // time to catch the checking-flag flip. Updated again inside poll()
  // after each cycle.
  nextCheckAt = new Date(Date.now() + firstPollMs).toISOString()
  firstPollHandle = setTimeout(() => {
    void runAndScheduleNext(intervalMs)
    intervalHandle = setInterval(() => void runAndScheduleNext(intervalMs), intervalMs)
  }, firstPollMs)
}

async function runAndScheduleNext(intervalMs: number) {
  await poll()
  nextCheckAt = new Date(Date.now() + intervalMs).toISOString()
}

/** Kick off the polling loop. Idempotent — safe to call from boot()
 *  multiple times. Reads enabled/intervalSeconds from user settings.
 *  If updates are disabled, this is a no-op (no timers, empty cache). */
export function startVersionCheck() {
  if (started) return
  started = true
  const { updates } = getSettings()
  if (!updates.enabled) return
  // First poll runs 1 s after boot to keep startup snappy without
  // making the user wait a full interval to see anything.
  scheduleLoop(updates.intervalSeconds, FIRST_POLL_DELAY_MS)
}

/** Apply new settings on the fly. Called from the /api/settings PATCH
 *  handler so the user never has to restart the server.
 *  - enabled flipped on  → start polling now (the user just clicked
 *    the toggle, they expect a fresh check immediately).
 *  - enabled flipped off → stop polling, clear cache + check state,
 *    the pill disappears on the next /api/version refetch.
 *  - interval changed    → reschedule with the new value. */
export function applyVersionCheckSettings() {
  const { updates } = getSettings()
  clearTimers()
  if (!updates.enabled) {
    cache = null
    lastError = null
    lastCheckedAt = null
    nextCheckAt = null
    return
  }
  scheduleLoop(updates.intervalSeconds, FIRST_POLL_DELAY_MS)
}
