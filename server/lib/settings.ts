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

export type UpdatesSettings = {
  /** Master switch for the GitHub release poller and the "new version
   *  available" pill in the header. Off → server stops polling and
   *  /api/version returns latest:null, so the pill disappears. */
  enabled: boolean
  /** Polling interval in hours. Allowed: 1, 6 (default), 24, 168.
   *  Free-form numbers also accepted at the API boundary — UI just
   *  doesn't expose them. */
  intervalHours: number
}

export type Settings = {
  updates: UpdatesSettings
}

const DEFAULTS: Settings = {
  updates: {
    enabled: true,
    intervalHours: 6,
  },
}

function readSection<K extends keyof Settings>(key: K): Settings[K] {
  const row = db().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  if (!row) return DEFAULTS[key]
  try {
    const parsed = JSON.parse(row.value) as Partial<Settings[K]>
    // Spread default first so a row missing a newly-added field still
    // gets the default value — no migration needed when fields land.
    return { ...DEFAULTS[key], ...parsed } as Settings[K]
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
  return { updates: readSection('updates') }
}

export function patchUpdates(patch: Partial<UpdatesSettings>): UpdatesSettings {
  const current = readSection('updates')
  const next: UpdatesSettings = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    intervalHours: clampInterval(patch.intervalHours ?? current.intervalHours),
  }
  writeSection('updates', next)
  return next
}

function clampInterval(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 6
  // Sane bounds: minimum 1h (GitHub rate-limit headroom on a single
  // server), maximum 30 days (longer = effectively "never check").
  return Math.max(1, Math.min(720, v))
}
