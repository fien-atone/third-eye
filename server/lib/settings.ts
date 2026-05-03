/** User-controlled settings. Stored in the `settings` table as one
 *  JSON blob per top-level section (key = section name). Sections are
 *  read/written as typed objects — callers don't see the JSON layer.
 *
 *  Adding a new field: extend the type, add a default in DEFAULTS,
 *  done. Old rows missing the field merge through the default
 *  automatically (see readSection's spread).
 *
 *  Adding a new section: extend Settings + DEFAULTS, expose a typed
 *  getter, and update /api/settings to surface it. */
import { db } from '../db.ts'

/** Server is in dev mode when NODE_ENV is anything other than
 *  "production". The Dockerfile sets NODE_ENV=production explicitly,
 *  so "production" here means "running from a container or other
 *  intentional prod start". Used to gate sub-hour polling intervals
 *  (which would hammer GitHub if shipped to real users). */
export const IS_DEV = process.env.NODE_ENV !== 'production'

export type UpdatesSettings = {
  /** Master switch for the GitHub release poller and the "new version
   *  available" pill in the header. Off → server stops polling and
   *  /api/version returns latest:null, so the pill disappears. */
  enabled: boolean
  /** Polling interval in seconds. Allowed minimum: 30 in dev, 3600
   *  (1 hour) in prod. UI exposes a curated set of presets (per
   *  client/src/components/settings-modal.tsx). */
  intervalSeconds: number
}

export type IngestSettings = {
  /** Master switch for the in-app auto-ingest timer. Off (the
   *  default) → only the manual Refresh button + the legacy env-
   *  driven THIRD_EYE_INGEST_INTERVAL_MIN trigger ingests. The user
   *  who enables this is opting into background scans; we don't do
   *  it by default because some users prefer to control when their
   *  Claude session dirs are read (e.g. on shared dev machines). */
  enabled: boolean
  /** Tick interval in seconds. Auto-tick fires every N seconds and
   *  attempts an incremental ingest (dedup'd through the lock —
   *  if a manual Refresh is in flight, the tick piggy-backs on it).
   *  Allowed minimum: 30 in dev, 60 in prod. */
  intervalSeconds: number
}

export type Settings = {
  updates: UpdatesSettings
  ingest: IngestSettings
}

const DEFAULTS: Settings = {
  updates: {
    enabled: true,
    // 1 hour. Default needs to be tame enough that even a forgetful
    // user with the dashboard pinned in a browser tab won't burn
    // GitHub's 60 req/h unauthenticated rate limit. Saving the
    // explicit "6h" default would have been fine in isolation, but
    // 1h is an easier number for users to reason about.
    intervalSeconds: 3600,
  },
  ingest: {
    // Off by default. The user enables it explicitly from Settings
    // when they want to stop having to click Refresh manually.
    enabled: false,
    // 5 minutes — frequent enough that "I just used Codex" data
    // shows up promptly, infrequent enough not to thrash disk on
    // huge ~/.claude/projects trees. The UI offers presets
    // (1m / 5m / 15m / 1h).
    intervalSeconds: 300,
  },
}

const MIN_UPDATES_INTERVAL_DEV_S = 30
const MIN_UPDATES_INTERVAL_PROD_S = 3600
const MAX_UPDATES_INTERVAL_S = 30 * 24 * 3600 // 30 days

const MIN_INGEST_INTERVAL_DEV_S = 30
const MIN_INGEST_INTERVAL_PROD_S = 60
const MAX_INGEST_INTERVAL_S = 24 * 3600 // 1 day

function readSection<K extends keyof Settings>(key: K): Settings[K] {
  const row = db().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  if (!row) return DEFAULTS[key]
  try {
    const parsed = JSON.parse(row.value) as Partial<Settings[K]>
    // Spread default first so a row missing a newly-added field still
    // gets the default value — no migration needed when fields land.
    const merged = { ...DEFAULTS[key], ...parsed } as Settings[K]
    // Defensive clamp on read. Scenario: user runs in dev with
    // intervalSeconds=30, ships data/third-eye.db to a prod
    // container. Without this, the prod server would happily poll
    // GitHub every 30 s and hit rate limits. The clamp here mirrors
    // patchUpdates so a stale dev row gets transparently upgraded
    // to a prod-safe value at read time.
    if (key === 'updates') {
      const m = merged as UpdatesSettings
      return { ...m, intervalSeconds: clampUpdatesInterval(m.intervalSeconds) } as Settings[K]
    }
    if (key === 'ingest') {
      const m = merged as IngestSettings
      return { ...m, intervalSeconds: clampIngestInterval(m.intervalSeconds) } as Settings[K]
    }
    return merged
  } catch {
    return DEFAULTS[key]
  }
}

function writeSection<K extends keyof Settings>(key: K, value: Settings[K]) {
  db().prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(value))
}

export function getSettings(): Settings {
  return {
    updates: readSection('updates'),
    ingest: readSection('ingest'),
  }
}

export function patchUpdates(patch: Partial<UpdatesSettings>): UpdatesSettings {
  const current = readSection('updates')
  const next: UpdatesSettings = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    intervalSeconds: clampUpdatesInterval(patch.intervalSeconds ?? current.intervalSeconds),
  }
  writeSection('updates', next)
  return next
}

export function patchIngest(patch: Partial<IngestSettings>): IngestSettings {
  const current = readSection('ingest')
  const next: IngestSettings = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    intervalSeconds: clampIngestInterval(patch.intervalSeconds ?? current.intervalSeconds),
  }
  writeSection('ingest', next)
  return next
}

function clampUpdatesInterval(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : DEFAULTS.updates.intervalSeconds
  const min = IS_DEV ? MIN_UPDATES_INTERVAL_DEV_S : MIN_UPDATES_INTERVAL_PROD_S
  return Math.max(min, Math.min(MAX_UPDATES_INTERVAL_S, v))
}

function clampIngestInterval(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : DEFAULTS.ingest.intervalSeconds
  const min = IS_DEV ? MIN_INGEST_INTERVAL_DEV_S : MIN_INGEST_INTERVAL_PROD_S
  return Math.max(min, Math.min(MAX_INGEST_INTERVAL_S, v))
}
