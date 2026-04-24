/** Background poll of the GitHub Releases API for the latest tag of
 *  this repo. Caches the result in memory so /api/version returns
 *  instantly without hitting GitHub on every request.
 *
 *  - First poll runs 30 s after import (lets the server finish its
 *    boot warmup before the first outbound HTTP call).
 *  - Subsequent polls every 6 h.
 *  - On error we keep the previous cache and log a single warning;
 *    the next poll retries.
 *  - If GitHub is unreachable forever (no internet, firewall) the
 *    cache stays `null` and the UI hides the update pill silently.
 */

const REPO = 'fien-atone/third-eye'
const FIRST_POLL_DELAY_MS = 30_000
const POLL_INTERVAL_MS = 6 * 60 * 60_000 // 6 hours
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
    // Single warning per failure — don't spam logs every 6 hours of
    // permanent network outage.
    console.warn(`[version-check] failed: ${lastError}`)
  }
}

/** Kick off the polling loop. Idempotent — safe to call from boot()
 *  multiple times. */
export function startVersionCheck() {
  if (started) return
  started = true
  setTimeout(poll, FIRST_POLL_DELAY_MS)
  setInterval(poll, POLL_INTERVAL_MS)
}
