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

const REPO = 'fien-atone/third-eye'
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
let checking = false
let intervalHandle: ReturnType<typeof setInterval> | null = null
let firstPollHandle: ReturnType<typeof setTimeout> | null = null
let started = false

export function getLatestRelease(): LatestRelease {
  return cache
}

export function getLastError(): string | null {
  return lastError
}

export function getCheckState(): { checking: boolean; lastCheckedAt: string | null } {
  return { checking, lastCheckedAt }
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

// GitHub responds in 100–800 ms, but we want the "checking…" spinner
// in the header to register visually. Hold the checking flag for at
// least this long so a 2-second client refetch catches it reliably.
const MIN_CHECKING_VISIBLE_MS = 1200

async function poll() {
  checking = true
  const startedAt = Date.now()
  try {
    const next = await fetchLatest()
    if (next) cache = next
    lastCheckedAt = new Date().toISOString()
    if (lastError) {
      console.warn(`[version-check] failed: ${lastError}`)
    }
  } finally {
    const elapsed = Date.now() - startedAt
    if (elapsed < MIN_CHECKING_VISIBLE_MS) {
      setTimeout(() => { checking = false }, MIN_CHECKING_VISIBLE_MS - elapsed)
    } else {
      checking = false
    }
  }
}

function clearTimers() {
  if (firstPollHandle) { clearTimeout(firstPollHandle); firstPollHandle = null }
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null }
}

function scheduleLoop(intervalSeconds: number, firstPollMs: number) {
  clearTimers()
  const intervalMs = Math.max(1, intervalSeconds) * 1000
  firstPollHandle = setTimeout(() => {
    void poll()
    intervalHandle = setInterval(poll, intervalMs)
  }, firstPollMs)
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
    return
  }
  scheduleLoop(updates.intervalSeconds, FIRST_POLL_DELAY_MS)
}
