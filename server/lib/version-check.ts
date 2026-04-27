/** Background poll of the GitHub Releases API for the latest tag of
 *  this repo. Caches the result in memory so /api/version returns
 *  instantly without hitting GitHub on every request.
 *
 *  - First poll runs 30 s after import (lets the server finish its
 *    boot warmup before the first outbound HTTP call).
 *  - Subsequent polls every N hours, where N comes from user settings
 *    (`updates.intervalHours`, default 6h).
 *  - On error we keep the previous cache and log a single warning;
 *    the next poll retries.
 *  - If the user disables updates in settings, the loop stops, the
 *    cache is cleared, and /api/version returns latest:null so the
 *    "new version available" pill disappears.
 *  - applySettings() (called from the /api/settings PATCH handler)
 *    restarts the loop with the new interval — no server restart
 *    needed. */

import { getSettings } from './settings.ts'

const REPO = 'fien-atone/third-eye'
const FIRST_POLL_DELAY_MS = 30_000
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
let intervalHandle: ReturnType<typeof setInterval> | null = null
let firstPollHandle: ReturnType<typeof setTimeout> | null = null
let started = false

export function getLatestRelease(): LatestRelease {
  return cache
}

export function getLastError(): string | null {
  return lastError
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
  const next = await fetchLatest()
  if (next) cache = next
  if (lastError) {
    // Single warning per failure — don't spam logs every interval of
    // permanent network outage.
    console.warn(`[version-check] failed: ${lastError}`)
  }
}

function clearTimers() {
  if (firstPollHandle) { clearTimeout(firstPollHandle); firstPollHandle = null }
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null }
}

function scheduleLoop(intervalHours: number, firstPollMs: number) {
  clearTimers()
  const intervalMs = Math.max(1, intervalHours) * 60 * 60_000
  firstPollHandle = setTimeout(() => {
    void poll()
    intervalHandle = setInterval(poll, intervalMs)
  }, firstPollMs)
}

/** Kick off the polling loop. Idempotent — safe to call from boot()
 *  multiple times. Reads enabled/intervalHours from user settings.
 *  If updates are disabled, this is a no-op (no timers, empty cache). */
export function startVersionCheck() {
  if (started) return
  started = true
  const { updates } = getSettings()
  if (!updates.enabled) return
  scheduleLoop(updates.intervalHours, FIRST_POLL_DELAY_MS)
}

/** Apply new settings on the fly. Called from the /api/settings PATCH
 *  handler so the user never has to restart the server.
 *  - enabled flipped on  → start polling now (no 30 s warmup wait;
 *    the user just clicked the toggle, they expect a fresh check).
 *  - enabled flipped off → stop polling, clear cache, the pill
 *    disappears on the next /api/version refetch.
 *  - interval changed    → reschedule with the new value. */
export function applyVersionCheckSettings() {
  const { updates } = getSettings()
  clearTimers()
  if (!updates.enabled) {
    cache = null
    lastError = null
    return
  }
  // First poll fires almost immediately (1 s) so the user sees the
  // freshly-fetched state right after clicking Save.
  scheduleLoop(updates.intervalHours, 1_000)
}
