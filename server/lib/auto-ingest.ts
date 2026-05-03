/** In-app auto-ingest timer driven by `settings.ingest`.
 *
 *  Replaces the env-var based `THIRD_EYE_INGEST_INTERVAL_MIN` cron-
 *  ish trigger as the primary auto-update mechanism. The env var
 *  still works (defined in index.ts boot block) for users who
 *  prefer container-level control; this module adds settings-driven
 *  control that the user can toggle from the UI without restarting
 *  the server.
 *
 *  Coordination with the ingest lock (lib/ingest-lock.ts):
 *    - Each tick goes through `withIngestLock('incremental', 'dedup')`
 *      so a tick that fires while a manual Refresh is already in
 *      flight piggy-backs on it instead of spawning a parallel scan.
 *    - A tick fired while another tick is still running ALSO dedups
 *      — protects against pathological cases where the user sets a
 *      30 s interval but their disk produces a 45 s ingest. We log
 *      the dedup so it's visible in profiles.
 *
 *  Settings hot-reload:
 *    - `applySettings()` is the entry point; call it on boot AND
 *      after any /api/settings PATCH that may have changed the
 *      ingest section. It cancels the existing timer (if any) and
 *      starts a new one with the current settings, or stops
 *      everything if `enabled=false`.
 *    - This avoids a per-tick "did the interval change?" check
 *      and keeps the timer state simple. */

import { runIngest } from '../ingest.ts'
import { withIngestLock, IngestBusyError } from './ingest-lock.ts'
import { getSettings } from './settings.ts'

let timer: NodeJS.Timeout | null = null
let activeIntervalSeconds: number | null = null

/** Read current settings and (re)start or stop the auto-tick timer
 *  to match. Idempotent: calling twice with the same settings is a
 *  no-op aside from logging. Safe to call from boot and from the
 *  /api/settings PATCH handler. */
export function applyAutoIngestSettings(): void {
  const { ingest } = getSettings()
  if (!ingest.enabled) {
    if (timer) {
      clearInterval(timer)
      timer = null
      activeIntervalSeconds = null
      console.log('[ingest:auto] disabled')
    }
    return
  }
  if (timer && activeIntervalSeconds === ingest.intervalSeconds) {
    // Already running at the requested cadence, nothing to do.
    return
  }
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  const ms = ingest.intervalSeconds * 1000
  timer = setInterval(tick, ms)
  activeIntervalSeconds = ingest.intervalSeconds
  console.log(`[ingest:auto] enabled, every ${ingest.intervalSeconds}s`)
}

async function tick(): Promise<void> {
  try {
    const { result, deduped } = await withIngestLock('incremental', 'dedup', () =>
      // Incremental currently aliases to full inside runIngest;
      // mtime-gating lands in a follow-up commit and `since` becomes
      // the time of the previous ingest. Until then we let runIngest
      // do its thing and the lock provides the only behavioral
      // guarantee that matters: no overlap.
      runIngest(),
    )
    if (deduped) {
      console.log('[ingest:auto] deduped (manual or prior tick still running)')
    } else {
      console.log('[ingest:auto]', { mode: result.mode, total: result.total, durationMs: result.durationMs })
    }
  } catch (err) {
    if (err instanceof IngestBusyError) {
      // Can't actually reach this branch under dedup policy, but
      // future-proof in case the policy is widened.
      console.log('[ingest:auto] skipped:', err.message)
      return
    }
    console.error('[ingest:auto] failed:', (err as Error).message)
  }
}

/** Report current scheduler state. Used by tests and (potentially)
 *  a debug endpoint. The timer object itself stays internal. */
export function getAutoIngestState(): { enabled: boolean; intervalSeconds: number | null } {
  return {
    enabled: timer !== null,
    intervalSeconds: activeIntervalSeconds,
  }
}
