import express from 'express'
import cors from 'cors'
import { existsSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { db, getMeta, seedScreenLayouts } from './db.ts'
import { runIngest } from './ingest.ts'
import { withIngestLock, IngestBusyError, getActiveIngest } from './lib/ingest-lock.ts'
import { DEFAULT_LAYOUTS, KNOWN_SCREENS, type ScreenLayout } from './lib/default-layouts.ts'
import { getLatestRelease, getCheckState, startVersionCheck, applyVersionCheckSettings, seedLatestRelease } from './lib/version-check.ts'
import { envRead, envReadNumber } from './lib/env.ts'
import {
  countUnclassified, countUnclassifiedGlobal, listDetectedRoles,
  listRegistry, upsertRegistry, deleteRegistry, acknowledgeAllUndetected,
  isProjectConfigured, isAnyProjectConfigured,
} from './lib/agent-registry.ts'
import { getSettings, patchUpdates, patchIngest, IS_DEV } from './lib/settings.ts'
import { applyAutoIngestSettings } from './lib/auto-ingest.ts'

// Seed default screen layouts on first start (idempotent — never overwrites
// user customizations once they exist).
seedScreenLayouts(DEFAULT_LAYOUTS)

const __dirname = dirname(fileURLToPath(import.meta.url))

type Granularity = 'hour' | 'day' | 'week' | 'month'

function parseTzMin(q: unknown): number {
  const n = parseInt(String(q ?? '0'), 10)
  return Number.isFinite(n) && n >= -840 && n <= 840 ? n : 0
}

/** Interpret YYYY-MM-DD as a local-to-the-client calendar day, return UTC ms range. */
function localDayRange(s: unknown, tzMin: number): { start: number; end: number } | null {
  if (typeof s !== 'string') return null
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const [, y, mo, da] = m
  const startUtc = Date.UTC(+y, +mo - 1, +da, 0, 0, 0, 0) - tzMin * 60_000
  const endUtc = Date.UTC(+y, +mo - 1, +da, 23, 59, 59, 999) - tzMin * 60_000
  return { start: startUtc, end: endUtc }
}

/** Format epoch ms as YYYY-MM-DD in the client's timezone. */
function fmtClientDate(ms: number, tzMin: number): string {
  const shifted = new Date(ms + tzMin * 60_000)
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function bucketSql(g: Granularity, tzMin: number, weekStartsOn: number, col: string = 'ts'): string {
  const sign = tzMin >= 0 ? '+' : '-'
  const tz = `'${sign}${Math.abs(tzMin)} minutes'`
  if (g === 'month') return `strftime('%Y-%m', datetime(${col}, ${tz}))`
  if (g === 'week') {
    // end-of-week weekday = the day BEFORE the week's first day.
    // SQLite 'weekday N' advances to the next occurrence of weekday N (0=Sun..6=Sat);
    // then -6 days gives the start of the week containing the date.
    const endOfWeek = (weekStartsOn + 6) % 7
    return `strftime('%Y-%m-%d', date(${col}, ${tz}, 'weekday ${endOfWeek}', '-6 days'))`
  }
  // Hour bucket key includes the date so widgets that span more than
  // one calendar day (rare for the day-view, but possible for ranges)
  // don't collapse "Mon 14:00" and "Tue 14:00" into a single bar.
  if (g === 'hour') return `strftime('%Y-%m-%d %H:00', datetime(${col}, ${tz}))`
  return `strftime('%Y-%m-%d', datetime(${col}, ${tz}))`
}


/**
 * Generate bucket keys aligned with SQLite's tz-shifted strftime output.
 * All math runs in the client's local frame via epoch-shifting — never touches server-tz.
 */
function fillBuckets(startEpoch: number, endEpoch: number, g: Granularity, tzMin: number, weekStartsOn: number): string[] {
  const keys: string[] = []
  const offsetMs = tzMin * 60_000
  const cur = new Date(startEpoch + offsetMs)
  cur.setUTCHours(0, 0, 0, 0)

  if (g === 'hour') {
    // Walk hour-by-hour from the start. Same epoch-shifted scheme as
    // day buckets — the cursor is held in the client's local frame
    // (UTC math on the shifted date) and we shift back when emitting.
    while (cur.getTime() - offsetMs <= endEpoch) {
      const ms = cur.getTime() - offsetMs
      keys.push(`${fmtClientDate(ms, tzMin)} ${String(cur.getUTCHours()).padStart(2, '0')}:00`)
      cur.setUTCHours(cur.getUTCHours() + 1)
    }
  } else if (g === 'day') {
    while (cur.getTime() - offsetMs <= endEpoch) {
      keys.push(fmtClientDate(cur.getTime() - offsetMs, tzMin))
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
  } else if (g === 'week') {
    // Offset from current weekday back to the configured week-start.
    const diff = (cur.getUTCDay() - weekStartsOn + 7) % 7
    cur.setUTCDate(cur.getUTCDate() - diff)
    while (cur.getTime() - offsetMs <= endEpoch) {
      keys.push(fmtClientDate(cur.getTime() - offsetMs, tzMin))
      cur.setUTCDate(cur.getUTCDate() + 7)
    }
  } else {
    cur.setUTCDate(1)
    while (cur.getTime() - offsetMs <= endEpoch) {
      const y = cur.getUTCFullYear()
      const m = String(cur.getUTCMonth() + 1).padStart(2, '0')
      keys.push(`${y}-${m}`)
      cur.setUTCMonth(cur.getUTCMonth() + 1)
    }
  }
  return keys
}

function providerFilterSql(providers: string[]): { where: string; params: unknown[] } {
  if (providers.length === 0) return { where: '', params: [] }
  const placeholders = providers.map(() => '?').join(',')
  return { where: `AND provider IN (${placeholders})`, params: providers }
}

function normalizeProviders(q: unknown): string[] {
  if (typeof q !== 'string' || !q.trim() || q === 'all') return []
  return q.split(',').map(s => s.trim()).filter(Boolean)
}

const app = express()
// Disable Express's automatic ETag / 304 dance for JSON endpoints.
// We're a self-hosted localhost dashboard — saving the body bytes
// of a small response is a non-feature, while the resulting 304s
// vs 200s in DevTools just confuse the picture when debugging
// polling cadence.
app.set('etag', false)
// CORS: allow only the vite dev server and same-origin Docker/static use.
// Override via THIRD_EYE_CORS_ORIGIN="https://your.host" if you ever expose this publicly (not recommended).
// Legacy CODEBURN_CORS_ORIGIN is still read for backwards compat (see server/lib/env.ts).
const corsOrigin = envRead('THIRD_EYE_CORS_ORIGIN', 'CODEBURN_CORS_ORIGIN') ?? [
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:5180', 'http://127.0.0.1:5180',
]
app.use(cors({ origin: corsOrigin }))
app.use(express.json())

const PROVIDER_DISPLAY: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex (OpenAI)',
}

/** Single source of truth for project-label resolution.
 *  Priority: user's custom rename → algorithmic auto-label → raw filesystem key.
 *  Used everywhere the UI needs to display "the project's name". */
function resolveLabel(row: { custom_label: string | null; label: string | null; key: string }): string {
  return row.custom_label ?? row.label ?? row.key
}

/** Round a USD amount for JSON serialization. 4 decimals = 0.01¢ precision —
 *  finer than any real-world cost we report. Returns 0 for null/undefined/NaN
 *  so a missing aggregate never leaks `null` or `NaN` into the response. */
function roundUsd(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0
  return Number(n.toFixed(4))
}

/** Standard projection of the projects table. Add a column here once and it
 *  shows up in every project lookup automatically — no risk of one endpoint
 *  forgetting a new field (as happened with `is_favorite` initially). */
type ProjectRow = {
  id: string
  key: string
  label: string | null
  custom_label: string | null
  is_favorite: number
}
// NB: `archived` column still exists in the DB (kept for backwards-compat /
// data preservation) but the feature was removed from the UI — if you ever
// bring it back, add it here and it'll flow through every project lookup.
const PROJECT_COLS = 'id, key, label, custom_label, is_favorite'

function getProjectById(d: ReturnType<typeof db>, id: string): ProjectRow | undefined {
  return d.prepare(`SELECT ${PROJECT_COLS} FROM projects WHERE id = ?`).get(id) as ProjectRow | undefined
}
function getProjectByKey(d: ReturnType<typeof db>, key: string): ProjectRow | undefined {
  return d.prepare(`SELECT ${PROJECT_COLS} FROM projects WHERE key = ?`).get(key) as ProjectRow | undefined
}
function getProjectsByKeys(d: ReturnType<typeof db>, keys: string[]): ProjectRow[] {
  if (keys.length === 0) return []
  const placeholders = keys.map(() => '?').join(',')
  return d.prepare(`SELECT ${PROJECT_COLS} FROM projects WHERE key IN (${placeholders})`).all(...keys) as ProjectRow[]
}

app.get('/api/projects', (_req, res) => {
  const rows = db().prepare(`
    SELECT p.id, p.key, p.label, p.custom_label, p.is_favorite,
           COUNT(c.dedup_key) AS calls,
           COALESCE(SUM(c.cost_usd), 0) AS cost,
           MIN(c.ts) AS first_ts,
           MAX(c.ts) AS last_ts
    FROM projects p
    LEFT JOIN api_calls c ON c.project = p.key AND c.model_short != '<synthetic>'
    GROUP BY p.id
    HAVING calls > 0
    ORDER BY cost DESC
  `).all() as Array<{
    id: string; key: string; label: string | null; custom_label: string | null;
    is_favorite: number; calls: number; cost: number;
    first_ts: string; last_ts: string
  }>
  res.json({
    projects: rows.map(r => ({
      id: r.id,
      key: r.key,
      label: resolveLabel(r),
      autoLabel: r.label ?? r.key,
      customLabel: r.custom_label,
      favorite: r.is_favorite === 1,
      calls: r.calls,
      cost: roundUsd(r.cost),
      firstTs: r.first_ts,
      lastTs: r.last_ts,
    })),
  })
})

// User-editable project metadata. Body: { customLabel?: string|null, favorite?: boolean }
// Pass customLabel: null (or empty string) to clear the override.
app.patch('/api/projects/:id', (req, res) => {
  const id = req.params.id
  const body = req.body as { customLabel?: string | null; favorite?: boolean }
  const d = db()
  const existing = d.prepare('SELECT id FROM projects WHERE id = ?').get(id) as { id: string } | undefined
  if (!existing) return res.status(404).json({ error: 'project not found' })

  const updates: string[] = []
  const params: unknown[] = []
  if ('customLabel' in body) {
    const cl = body.customLabel
    const norm = typeof cl === 'string' && cl.trim() ? cl.trim().slice(0, 200) : null
    updates.push('custom_label = ?')
    params.push(norm)
  }
  if ('favorite' in body) {
    updates.push('is_favorite = ?')
    params.push(body.favorite ? 1 : 0)
  }
  if (updates.length === 0) return res.status(400).json({ error: 'no updatable fields in body' })

  params.push(id)
  d.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...params)

  const row = getProjectById(d, id)!
  res.json({
    id: row.id,
    key: row.key,
    label: resolveLabel(row),
    autoLabel: row.label ?? row.key,
    customLabel: row.custom_label,
    favorite: row.is_favorite === 1,
  })
})

// ──────────────────────────────────────────────────────────────────────
// Screen layouts — per-screen widget grids editable in the UI.
// Layout shape is opaque to the server (just a JSON blob); the client
// decides which widget ids are valid via its catalog. Server only:
//   1. validates `screen` is a known name (prevents arbitrary writes)
//   2. validates JSON parses
//   3. round-trips the blob
// ──────────────────────────────────────────────────────────────────────

function getLayout(screen: string): ScreenLayout {
  const row = db().prepare('SELECT layout_json FROM screen_layouts WHERE screen = ?').get(screen) as { layout_json: string } | undefined
  if (row) {
    try { return JSON.parse(row.layout_json) as ScreenLayout } catch { /* fall through to default */ }
  }
  return DEFAULT_LAYOUTS[screen]
}

app.get('/api/layout/:screen', (req, res) => {
  const screen = req.params.screen
  if (!KNOWN_SCREENS.has(screen)) return res.status(404).json({ error: 'unknown screen' })
  res.json(getLayout(screen))
})

app.put('/api/layout/:screen', (req, res) => {
  const screen = req.params.screen
  if (!KNOWN_SCREENS.has(screen)) return res.status(404).json({ error: 'unknown screen' })
  const body = req.body as ScreenLayout
  if (!body || !Array.isArray(body.widgets) || !Array.isArray(body.hidden)) {
    return res.status(400).json({ error: 'invalid layout shape' })
  }
  db().prepare(`INSERT INTO screen_layouts (screen, layout_json, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(screen) DO UPDATE SET layout_json = excluded.layout_json, updated_at = excluded.updated_at`)
    .run(screen, JSON.stringify(body), new Date().toISOString())
  res.json({ ok: true })
})

// Reset to factory default — overwrites with the constant from default-layouts.ts.
app.delete('/api/layout/:screen', (req, res) => {
  const screen = req.params.screen
  if (!KNOWN_SCREENS.has(screen)) return res.status(404).json({ error: 'unknown screen' })
  db().prepare(`INSERT INTO screen_layouts (screen, layout_json, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(screen) DO UPDATE SET layout_json = excluded.layout_json, updated_at = excluded.updated_at`)
    .run(screen, JSON.stringify(DEFAULT_LAYOUTS[screen]), new Date().toISOString())
  res.json(DEFAULT_LAYOUTS[screen])
})

app.get('/api/providers', (_req, res) => {
  const rows = db().prepare(`
    SELECT provider, COUNT(*) as calls, SUM(cost_usd) as cost, MIN(ts) as first_ts, MAX(ts) as last_ts
    FROM api_calls
    GROUP BY provider
    ORDER BY cost DESC
  `).all() as Array<{ provider: string; calls: number; cost: number; first_ts: string; last_ts: string }>

  res.json({
    providers: rows.map(r => ({
      id: r.provider,
      label: PROVIDER_DISPLAY[r.provider] ?? r.provider,
      calls: r.calls,
      cost: roundUsd(r.cost),
      firstTs: r.first_ts,
      lastTs: r.last_ts,
    })),
    lastIngestAt: getMeta('last_ingest_at'),
  })
})

app.post('/api/refresh', async (req, res) => {
  // Three modes:
  //   - incremental — fast scan of files mtime'd after last_ingest_at
  //                   (currently aliases to full; mtime gating lands in
  //                   a follow-up commit). Default for the manual
  //                   Refresh button + auto-tick.
  //   - full        — re-scan everything. Used when the caller wants
  //                   to be sure nothing was missed, e.g. after a
  //                   provider config change.
  //   - rebuild     — truncate every table and re-ingest from scratch.
  //                   Destructive — UI gates this behind a confirm.
  //
  // Lock policy:
  //   incremental + full → dedup. If something is already running,
  //     the second caller piggy-backs on the in-flight Promise. Manual
  //     Refresh while auto-tick is mid-run no longer kicks off two
  //     parallel scans.
  //   rebuild → refuse. Returns 409 Conflict when busy because
  //     truncateAll() racing with an in-flight upsert would corrupt
  //     history. Client retries once the running op finishes.
  const modeRaw = typeof req.query.mode === 'string' ? req.query.mode : ''
  // Back-compat: the old `?full=true` flag still works (header button
  // and any external scripts in the wild).
  const legacyFull = req.query.full === 'true' || req.query.full === '1'
  const mode: 'incremental' | 'full' | 'rebuild' =
    modeRaw === 'rebuild' ? 'rebuild'
    : modeRaw === 'full' || legacyFull ? 'full'
    : modeRaw === 'incremental' ? 'incremental'
    : 'incremental'
  const since = typeof req.query.since === 'string' ? req.query.since : undefined

  try {
    const { result, deduped } = await withIngestLock(
      mode,
      mode === 'rebuild' ? 'refuse' : 'dedup',
      () => runIngest({
        since,
        // Incremental currently runs as full until mtime-gating lands.
        full: mode === 'full' || mode === 'incremental',
        rebuild: mode === 'rebuild',
      }),
    )
    // `mode` (API-contract input mode) wins over the `mode` field
    // runIngest's stats happen to also expose (its internal value
    // — full/rebuild/since); they're not always equal (incremental
    // currently runs as full under the hood). Spread first so the
    // explicit one overwrites.
    res.json({ ok: true, deduped, ...result, mode })
  } catch (err) {
    if (err instanceof IngestBusyError) {
      res.status(409).json({
        ok: false,
        error: 'busy',
        currentKind: err.currentKind,
        startedAt: new Date(err.startedAt).toISOString(),
      })
      return
    }
    res.status(500).json({ ok: false, error: (err as Error).message })
  }
})

app.get('/api/overview', (req, res) => {
  const granularity = (req.query.granularity as Granularity) ?? 'day'
  const tzMin = parseTzMin(req.query.tzOffsetMin)
  const wRaw = parseInt(String(req.query.weekStartsOn ?? '1'), 10)
  const weekStartsOn = wRaw >= 0 && wRaw <= 6 ? wRaw : 1
  const nowMs = Date.now()
  const defaultStartMs = nowMs - 30 * 86_400_000
  const startRange = localDayRange(req.query.start, tzMin)
  const endRange = localDayRange(req.query.end, tzMin)
  const startEpoch = startRange?.start ?? defaultStartMs
  const endEpoch = endRange?.end ?? nowMs
  const providers = normalizeProviders(req.query.providers)
  const projectIdRaw = typeof req.query.projectId === 'string' && req.query.projectId.trim() ? req.query.projectId.trim() : null
  const projectKeyRaw = typeof req.query.project === 'string' && req.query.project.trim() ? req.query.project.trim() : null

  let projectId: string | null = null
  let projectKey: string | null = null
  let projectLabel: string | null = null
  if (projectIdRaw) {
    const row = getProjectById(db(), projectIdRaw)
    if (row) { projectId = row.id; projectKey = row.key; projectLabel = resolveLabel(row) }
  } else if (projectKeyRaw) {
    const row = getProjectByKey(db(), projectKeyRaw)
    if (row) { projectId = row.id; projectKey = row.key; projectLabel = resolveLabel(row) }
    else projectKey = projectKeyRaw
  }

  const providerFilter = providerFilterSql(providers)
  const projectFilter = projectKey ? { where: 'AND project = ?', params: [projectKey] } : { where: '', params: [] as unknown[] }
  const baseParams = [startEpoch, endEpoch, ...providerFilter.params, ...projectFilter.params]
  const bucketExpr = bucketSql(granularity, tzMin, weekStartsOn)
  const d = db()

  const seriesRows = d.prepare(`
    SELECT ${bucketExpr} AS bucket,
           SUM(cost_usd)       AS cost,
           COUNT(*)            AS calls,
           SUM(input_tokens)   AS input_tokens,
           SUM(output_tokens)  AS output_tokens,
           SUM(cache_read)     AS cache_read,
           SUM(cache_write)    AS cache_write
    FROM api_calls
    WHERE ts_epoch BETWEEN ? AND ? AND model_short != '<synthetic>' ${providerFilter.where} ${projectFilter.where}
    GROUP BY bucket
  `).all(...baseParams) as Array<{
    bucket: string; cost: number; calls: number;
    input_tokens: number; output_tokens: number; cache_read: number; cache_write: number;
  }>

  const modelBucketRows = d.prepare(`
    SELECT ${bucketExpr} AS bucket, model_short, SUM(cost_usd) AS cost
    FROM api_calls
    WHERE ts_epoch BETWEEN ? AND ? AND model_short != '<synthetic>' ${providerFilter.where} ${projectFilter.where}
    GROUP BY bucket, model_short
  `).all(...baseParams) as Array<{ bucket: string; model_short: string; cost: number }>

  const modelTotals = d.prepare(`
    SELECT model_short AS name, COUNT(*) AS calls, SUM(cost_usd) AS cost,
           SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
           SUM(cache_read) AS cache_read, SUM(cache_write) AS cache_write
    FROM api_calls
    WHERE ts_epoch BETWEEN ? AND ? AND model_short != '<synthetic>' ${providerFilter.where} ${projectFilter.where}
    GROUP BY model_short
    ORDER BY cost DESC
  `).all(...baseParams) as Array<{
    name: string; calls: number; cost: number;
    input_tokens: number; output_tokens: number; cache_read: number; cache_write: number;
  }>

  const categoryTotals = d.prepare(`
    SELECT category AS name, COUNT(*) AS calls, SUM(cost_usd) AS cost
    FROM api_calls
    WHERE ts_epoch BETWEEN ? AND ? AND model_short != '<synthetic>' ${providerFilter.where} ${projectFilter.where}
    GROUP BY category
    ORDER BY cost DESC
  `).all(...baseParams) as Array<{ name: string; calls: number; cost: number }>

  const projectTotals = (d.prepare(`
    SELECT project AS name, COUNT(*) AS calls, SUM(cost_usd) AS cost
    FROM api_calls
    WHERE ts_epoch BETWEEN ? AND ? AND model_short != '<synthetic>' ${providerFilter.where} ${projectFilter.where}
    GROUP BY project
    ORDER BY cost DESC
  `).all(...baseParams) as Array<{ name: string; calls: number; cost: number }>)
    .slice(0, 30)

  // Resolve labels for ALL projectTotals (not just topProjectKeys) so the
  // dashboard's Top Projects table shows custom_label too. One extra query
  // for ~30 keys; cheap.
  const allProjectMeta: Record<string, { label: string; id: string | null; favorite: boolean }> = {}
  for (const r of getProjectsByKeys(d, projectTotals.map(p => p.name))) {
    allProjectMeta[r.key] = { label: resolveLabel(r), id: r.id, favorite: r.is_favorite === 1 }
  }

  // Per-project per-bucket breakdown for the "Project activity" stacked chart.
  // Top N by cost in current range, rest → "__other".
  const TOP_N_PROJECTS = 8
  const topProjectKeys = projectTotals.slice(0, TOP_N_PROJECTS).map(p => p.name)
  const projectBucketRows = topProjectKeys.length > 0
    ? d.prepare(`
        SELECT ${bucketExpr} AS bucket, project, SUM(cost_usd) AS cost
        FROM api_calls
        WHERE ts_epoch BETWEEN ? AND ? AND model_short != '<synthetic>' ${providerFilter.where} ${projectFilter.where}
        GROUP BY bucket, project
      `).all(...baseParams) as Array<{ bucket: string; project: string; cost: number }>
    : []
  const projectMeta: Record<string, { label: string; id: string | null }> = {}
  for (const r of getProjectsByKeys(d, topProjectKeys)) {
    projectMeta[r.key] = { label: resolveLabel(r), id: r.id }
  }

  const totals = d.prepare(`
    SELECT SUM(cost_usd) AS cost, COUNT(*) AS calls,
           SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
           SUM(cache_read) AS cache_read, SUM(cache_write) AS cache_write,
           COUNT(DISTINCT project) AS projects,
           -- Count calls from providers whose API actually reports
           -- cache_write tokens. Currently: anything that's not Codex.
           -- OpenAI's prompt caching is implicit (writes have no
           -- separate cost or token field), so summing cache_write
           -- across a Codex-only scope produces a misleading "0".
           -- We use this count to flip cache_write to NULL in that
           -- case, and the UI renders NULL as "—" (not "0").
           SUM(CASE WHEN provider != 'codex' THEN 1 ELSE 0 END) AS cache_write_supported_calls,
           SUM(CASE WHEN provider  = 'codex' THEN 1 ELSE 0 END) AS codex_calls
    FROM api_calls
    WHERE ts_epoch BETWEEN ? AND ? AND model_short != '<synthetic>' ${providerFilter.where} ${projectFilter.where}
  `).get(...baseParams) as {
    cost: number | null; calls: number; input_tokens: number | null; output_tokens: number | null;
    cache_read: number | null; cache_write: number | null; projects: number;
    cache_write_supported_calls: number; codex_calls: number;
  }

  // ─── Agent telemetry ───────────────────────────────────────────────
  // Scoped to the user-curated registry: only sessions whose raw role
  // is an enabled agent_registry row contribute. Anything the user
  // hasn't explicitly confirmed as an agent (unregistered, disabled,
  // `unknown`) is invisible here — per product decision, the widget
  // shows only what the user has claimed ownership of.
  const agentProjectFilter = projectKey ? 'AND s.project = ?' : ''
  const agentParams: unknown[] = projectKey ? [startEpoch, endEpoch, projectKey] : [startEpoch, endEpoch]

  // Common join-filter: session's role must match an enabled registry
  // row in its own project. The INNER JOIN alone enforces "classified
  // only" — a session with no matching registry row simply falls out.
  const agentFromClause = `
    FROM agent_sessions s
    INNER JOIN agent_registry r
      ON r.project = s.project AND r.raw_role = s.role AND r.enabled = 1
  `

  // Agent aggregate totals — registry-UNFILTERED. The aggregate KPIs
  // ("how big is my agent footprint?", "how does it compare to total
  // spend?") should always tell the truth, even when the user has
  // a stale or empty registry. The registry is for naming/grouping
  // in per-role breakdowns (byRole, topSessions, timeline,
  // toolSpectrum, spawnBatches), not for hiding aggregate truth.
  const agentTotals = d.prepare(`
    SELECT COUNT(*) AS sessions,
           COALESCE(SUM(input_tokens), 0)        AS input_tokens,
           COALESCE(SUM(cache_create_tokens), 0) AS cache_create,
           COALESCE(SUM(cache_read_tokens), 0)   AS cache_read,
           COALESCE(SUM(output_tokens), 0)       AS output_tokens,
           COALESCE(SUM(total_tokens), 0)        AS total_tokens,
           COALESCE(SUM(cost_usd), 0)            AS cost,
           COALESCE(SUM(tool_uses), 0)           AS tool_uses,
           COALESCE(SUM(duration_s), 0)          AS duration_s
    FROM agent_sessions
    WHERE ts_start_epoch BETWEEN ? AND ?
      ${projectKey ? 'AND project = ?' : ''}
  `).get(...(projectKey ? [startEpoch, endEpoch, projectKey] : [startEpoch, endEpoch])) as {
    sessions: number; input_tokens: number; cache_create: number; cache_read: number;
    output_tokens: number; total_tokens: number; cost: number; tool_uses: number; duration_s: number
  }

  // Effective role = user's display_name (if any) else raw role.
  // Merge resolution still walks one level to handle aliased roles,
  // even though the UI doesn't expose merge yet — the SQL is ready.
  const effectiveRoleExpr = `
    CASE
      WHEN r.merged_into IS NOT NULL AND r.merged_into != ''
        THEN COALESCE(
          NULLIF((SELECT display_name FROM agent_registry WHERE project = s.project AND raw_role = r.merged_into), ''),
          r.merged_into
        )
      ELSE COALESCE(NULLIF(r.display_name, ''), s.role)
    END
  `

  const agentByRole = d.prepare(`
    SELECT ${effectiveRoleExpr}       AS effective_role,
           COUNT(*)                   AS sessions,
           COALESCE(SUM(s.total_tokens), 0) AS tokens,
           COALESCE(SUM(s.cost_usd), 0)     AS cost,
           COALESCE(SUM(s.tool_uses), 0)    AS tool_uses
    ${agentFromClause}
    WHERE s.ts_start_epoch BETWEEN ? AND ? ${agentProjectFilter}
    GROUP BY effective_role
    ORDER BY cost DESC, tokens DESC
  `).all(...agentParams) as Array<{
    effective_role: string; sessions: number; tokens: number; cost: number; tool_uses: number
  }>

  const agentTopSessions = d.prepare(`
    SELECT s.agent_id, s.source, s.role AS raw_role,
           ${effectiveRoleExpr}        AS effective_role,
           s.role_confidence, s.description,
           s.ts_start, s.duration_s, s.total_tokens, s.cost_usd,
           s.tool_uses, s.api_calls
    ${agentFromClause}
    WHERE s.ts_start_epoch BETWEEN ? AND ? ${agentProjectFilter}
    ORDER BY s.cost_usd DESC
    LIMIT 25
  `).all(...agentParams) as Array<{
    agent_id: string; source: string; raw_role: string; effective_role: string;
    role_confidence: string; description: string; ts_start: string;
    duration_s: number; total_tokens: number; cost_usd: number;
    tool_uses: number; api_calls: number
  }>

  // Spawn batches: agents that share the same prompt_id were
  // dispatched in one parallel orchestration call. HAVING > 1 hides
  // singletons (every Task() with no fan-out gets a unique
  // prompt_id, and a list of those is just every agent ever).
  // Order by batch size descending — biggest fan-outs first.
  // Limit to 25 to keep the response trim.
  const agentBatchRows = d.prepare(`
    SELECT s.prompt_id                    AS prompt_id,
           COUNT(*)                       AS batch_size,
           MIN(s.ts_start)                AS spawned_at,
           MIN(s.ts_start_epoch)          AS spawned_at_epoch,
           COALESCE(SUM(s.cost_usd), 0)   AS cost,
           COALESCE(SUM(s.total_tokens), 0) AS tokens
    ${agentFromClause}
    WHERE s.ts_start_epoch BETWEEN ? AND ? ${agentProjectFilter}
      AND s.prompt_id IS NOT NULL
    GROUP BY s.prompt_id
    HAVING batch_size > 1
    -- Sort newest first — the widget reads as a log of recent
    -- orchestration calls. Earlier ordering by batch_size buried
    -- the most actionable rows below ancient mega-fan-outs.
    ORDER BY spawned_at_epoch DESC
    LIMIT 25
  `).all(...agentParams) as Array<{
    prompt_id: string; batch_size: number; spawned_at: string;
    spawned_at_epoch: number; cost: number; tokens: number
  }>

  // Roles per batch — second query so the GROUP_CONCAT doesn't blow
  // out the main row size. Returns the role list for batches that
  // actually appeared above.
  const batchPromptIds = agentBatchRows.map(r => r.prompt_id)
  const agentBatchRoles = batchPromptIds.length === 0 ? [] : d.prepare(`
    SELECT s.prompt_id              AS prompt_id,
           ${effectiveRoleExpr}     AS effective_role,
           COUNT(*)                 AS sessions
    ${agentFromClause}
    WHERE s.prompt_id IN (${batchPromptIds.map(() => '?').join(',')})
      ${projectKey ? 'AND s.project = ?' : ''}
    GROUP BY s.prompt_id, effective_role
  `).all(
    ...batchPromptIds,
    ...(projectKey ? [projectKey] : []),
  ) as Array<{ prompt_id: string; effective_role: string; sessions: number }>

  // Aggregate batch stats for the KPI tile: average size, max size,
  // total agents that ran inside batches (vs solo).
  const agentBatchAvgRow = d.prepare(`
    SELECT AVG(batch_size) AS avg_size, MAX(batch_size) AS max_size,
           SUM(batch_size) AS batched_agents, COUNT(*) AS batch_count
    FROM (
      SELECT COUNT(*) AS batch_size
      ${agentFromClause}
      WHERE s.ts_start_epoch BETWEEN ? AND ? ${agentProjectFilter}
        AND s.prompt_id IS NOT NULL
      GROUP BY s.prompt_id
      HAVING batch_size > 1
    )
  `).get(...agentParams) as {
    avg_size: number | null; max_size: number | null;
    batched_agents: number | null; batch_count: number | null
  }

  // Per-role tool-usage spectrum. One DB row per agent session
  // matching the registry filter; we sum tools_json per role in JS
  // (sessions are bounded — hundreds, not millions — so JSON.parse
  // overhead is fine, and SQL's json_each() varies by SQLite build).
  const agentToolsRows = d.prepare(`
    SELECT ${effectiveRoleExpr}  AS effective_role,
           s.tools_json,
           s.tool_uses
    ${agentFromClause}
    WHERE s.ts_start_epoch BETWEEN ? AND ? ${agentProjectFilter}
  `).all(...agentParams) as Array<{
    effective_role: string; tools_json: string; tool_uses: number
  }>

  // Per-bucket × per-agent cost for the timeline widget. Uses the same
  // bucketing (day/week/month/hour) as the rest of the dashboard so
  // users see agent activity aligned with other time-series widgets.
  const agentBucketExpr = bucketSql(granularity, tzMin, weekStartsOn, 's.ts_start')
  const agentTimelineRows = d.prepare(`
    SELECT ${agentBucketExpr}           AS bucket,
           ${effectiveRoleExpr}          AS effective_role,
           COALESCE(SUM(s.cost_usd), 0)  AS cost,
           COUNT(*)                      AS sessions
    ${agentFromClause}
    WHERE s.ts_start_epoch BETWEEN ? AND ? ${agentProjectFilter}
    GROUP BY bucket, effective_role
  `).all(...agentParams) as Array<{
    bucket: string; effective_role: string; cost: number; sessions: number
  }>

  const bucketKeys = fillBuckets(startEpoch, endEpoch, granularity, tzMin, weekStartsOn)
  const seriesMap = new Map(seriesRows.map(r => [r.bucket, r]))
  const modelByBucket = new Map<string, Map<string, number>>()
  for (const r of modelBucketRows) {
    const m = modelByBucket.get(r.bucket) ?? new Map<string, number>()
    m.set(r.model_short, r.cost)
    modelByBucket.set(r.bucket, m)
  }
  const topModels = modelTotals.slice(0, 8).map(m => m.name)

  const topProjectSet = new Set(topProjectKeys)
  const projectByBucket = new Map<string, Map<string, number>>()
  for (const r of projectBucketRows) {
    const key = topProjectSet.has(r.project) ? r.project : '__other'
    const m = projectByBucket.get(r.bucket) ?? new Map<string, number>()
    m.set(key, (m.get(key) ?? 0) + r.cost)
    projectByBucket.set(r.bucket, m)
  }

  // Agent timeline: group rows by bucket, keyed by effective role name.
  // The client receives a parallel series array with `agent:<role>`
  // columns per bucket for recharts stacking.
  const agentTimelineByBucket = new Map<string, Map<string, number>>()
  for (const r of agentTimelineRows) {
    const m = agentTimelineByBucket.get(r.bucket) ?? new Map<string, number>()
    m.set(r.effective_role, (m.get(r.effective_role) ?? 0) + r.cost)
    agentTimelineByBucket.set(r.bucket, m)
  }
  const agentRoleNames = Array.from(
    new Set(agentTimelineRows.map(r => r.effective_role))
  ).sort()
  const agentTimelineSeries = bucketKeys.map(k => {
    const row: Record<string, number | string> = { bucket: k }
    const ab = agentTimelineByBucket.get(k)
    for (const name of agentRoleNames) row[`agent:${name}`] = roundUsd(ab?.get(name))
    return row
  })

  // Tool spectrum aggregation. Build:
  //   - per-role tool counters
  //   - global tool counter (drives column ordering and "top N" trim)
  //   - per-role session count + total tool calls (denominator for %)
  const toolsByRole = new Map<string, Map<string, number>>()
  const sessionsByRole = new Map<string, number>()
  const totalToolUsesByRole = new Map<string, number>()
  const globalToolCounts = new Map<string, number>()
  for (const r of agentToolsRows) {
    sessionsByRole.set(r.effective_role, (sessionsByRole.get(r.effective_role) ?? 0) + 1)
    totalToolUsesByRole.set(r.effective_role, (totalToolUsesByRole.get(r.effective_role) ?? 0) + r.tool_uses)
    let bucket = toolsByRole.get(r.effective_role)
    if (!bucket) { bucket = new Map(); toolsByRole.set(r.effective_role, bucket) }
    try {
      const parsed = JSON.parse(r.tools_json) as Record<string, number>
      for (const [tool, n] of Object.entries(parsed)) {
        if (typeof n !== 'number' || n <= 0) continue
        bucket.set(tool, (bucket.get(tool) ?? 0) + n)
        globalToolCounts.set(tool, (globalToolCounts.get(tool) ?? 0) + n)
      }
    } catch { /* ignore corrupt tools_json */ }
  }
  // Top tools globally — UI uses this for column order. Cap at 8 so
  // a wide tile renders without horizontal-scroll on standard layouts;
  // long-tail tools are aggregated into "Other" client-side.
  const TOP_TOOLS_N = 8
  const agentTopTools = [...globalToolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_TOOLS_N)
    .map(([tool]) => tool)
  const agentToolSpectrum = [...toolsByRole.entries()]
    .map(([role, tools]) => ({
      role,
      sessions: sessionsByRole.get(role) ?? 0,
      toolUses: totalToolUsesByRole.get(role) ?? 0,
      tools: Object.fromEntries(tools),
    }))
    .sort((a, b) => b.toolUses - a.toolUses)

  const series = bucketKeys.map(k => {
    const s = seriesMap.get(k)
    const row: Record<string, number | string> = {
      bucket: k,
      cost: roundUsd(s?.cost),
      calls: s?.calls ?? 0,
      inputTokens: s?.input_tokens ?? 0,
      outputTokens: s?.output_tokens ?? 0,
      cacheRead: s?.cache_read ?? 0,
      cacheWrite: s?.cache_write ?? 0,
    }
    const mb = modelByBucket.get(k)
    for (const m of topModels) row[`model:${m}`] = roundUsd(mb?.get(m))
    const pb = projectByBucket.get(k)
    for (const key of topProjectKeys) row[`project:${key}`] = roundUsd(pb?.get(key))
    row['project:__other'] = roundUsd(pb?.get('__other'))
    return row
  })

  res.json({
    frame: {
      start: new Date(startEpoch).toISOString(),
      end: new Date(endEpoch).toISOString(),
      startEpoch,
      endEpoch,
      tzOffsetMin: tzMin,
      granularity,
      bucketCount: bucketKeys.length,
      providers,
      project: projectKey ? { id: projectId, key: projectKey, label: projectLabel ?? projectKey } : null,
    },
    totals: {
      cost: roundUsd(totals.cost),
      calls: totals.calls ?? 0,
      inputTokens: totals.input_tokens ?? 0,
      outputTokens: totals.output_tokens ?? 0,
      cacheRead: totals.cache_read ?? 0,
      // null when the scope contains no provider that reports cache
      // writes (currently: only Codex). UI distinguishes null ("—",
      // "no data") from 0 ("zero writes happened, here's the proof").
      cacheWrite: totals.cache_write_supported_calls > 0 ? (totals.cache_write ?? 0) : null,
      projects: totals.projects ?? 0,
    },
    // Codex / ChatGPT plan-usage snapshot. Only forwarded when the
    // request resolves to a SINGLE day (start === end as raw query
    // params), which matches the Today-view URL shape. For multi-day
    // ranges (Dashboard, Project) a single peak number isn't
    // meaningful and the widget shouldn't be on those screens anyway
    // (gated declaratively via `screens: ['today']` on the WidgetDef).
    // The day key is the same YYYY-MM-DD the client sent, which lines
    // up with codex_plan_daily.day (Codex's own session-dir day).
    codexPlan: ((): unknown => {
      const codexCount = totals.codex_calls
      if (!codexCount || codexCount === 0) return null
      const startStr = typeof req.query.start === 'string' ? req.query.start : null
      const endStr = typeof req.query.end === 'string' ? req.query.end : null
      if (!startStr || startStr !== endStr) return null
      const row = db().prepare('SELECT snapshot FROM codex_plan_daily WHERE day = ?').get(startStr) as
        | { snapshot: string }
        | undefined
      if (!row) return null
      try { return JSON.parse(row.snapshot) } catch { return null }
    })(),
    // Multi-day Codex plan history. Inverse of codexPlan above:
    // populated only when the range covers MORE than one day, fed
    // straight from the same codex_plan_daily table. The Dashboard's
    // history widget renders a line chart out of this; on Today
    // (single-day) and Project (account-wide rate-limits make no
    // sense scoped to one project) the field is null and the widget
    // self-gates via `screens: ['dashboard']`. Only days actually
    // present in the table are included — sparse ranges are honored
    // (no synthesized zero rows). Codex-call gate kept so the
    // history doesn't appear on Claude-only views.
    codexPlanHistory: ((): unknown => {
      const codexCount = totals.codex_calls
      if (!codexCount || codexCount === 0) return null
      const startStr = typeof req.query.start === 'string' ? req.query.start : null
      const endStr = typeof req.query.end === 'string' ? req.query.end : null
      if (!startStr || !endStr || startStr === endStr) return null
      const rows = db().prepare(
        'SELECT day, primary_pct, secondary_pct, snapshot, by_plan_json FROM codex_plan_daily WHERE day BETWEEN ? AND ? ORDER BY day',
      ).all(startStr, endStr) as Array<{
        day: string; primary_pct: number; secondary_pct: number; snapshot: string; by_plan_json: string | null
      }>

      // Map each daily row to its bucket key under the dashboard's
      // current granularity (day/week/month/hour). Day strings are
      // already in local-tz YYYY-MM-DD shape (Codex session dirs use
      // local TZ), so the math here is timezone-free.
      const dayToBucket = (dayStr: string): string => {
        if (granularity === 'day' || granularity === 'hour') return dayStr
        const [y, m, d] = dayStr.split('-').map(Number)
        const dt = new Date(Date.UTC(y, m - 1, d))
        if (granularity === 'week') {
          const weekday = dt.getUTCDay()
          const diff = (weekday - weekStartsOn + 7) % 7
          dt.setUTCDate(dt.getUTCDate() - diff)
          const yy = dt.getUTCFullYear()
          const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
          const dd = String(dt.getUTCDate()).padStart(2, '0')
          return `${yy}-${mm}-${dd}`
        }
        // month
        return `${y}-${String(m).padStart(2, '0')}`
      }

      // Aggregate daily rows into buckets. Per-bucket peaks: primary
      // and per-plan use max() of daily peaks (the worst day in the
      // bucket dominates the bar). Secondary stays null until we see
      // at least one Codex day in the bucket. exhausted = OR.
      type Agg = {
        primary: number
        secondary: number | null
        byPlan: Map<string, number>
        exhausted: boolean
        dayCount: number
      }
      const agg = new Map<string, Agg>()
      for (const k of bucketKeys) {
        agg.set(k, { primary: 0, secondary: null, byPlan: new Map(), exhausted: false, dayCount: 0 })
      }
      for (const r of rows) {
        const bk = dayToBucket(r.day)
        const a = agg.get(bk)
        if (!a) continue
        let snap: { planType?: string | null; credits?: { hasCredits?: boolean | null } | null } | null = null
        try { snap = JSON.parse(r.snapshot) } catch {}
        let byPlan: Record<string, number> = {}
        if (r.by_plan_json) {
          try { byPlan = JSON.parse(r.by_plan_json) as Record<string, number> } catch {}
        }
        if (Object.keys(byPlan).length === 0 && snap?.planType) {
          byPlan = { [snap.planType]: r.primary_pct }
        }
        if (r.primary_pct > a.primary) a.primary = r.primary_pct
        if (typeof r.secondary_pct === 'number') {
          a.secondary = a.secondary === null ? r.secondary_pct : Math.max(a.secondary, r.secondary_pct)
        }
        for (const [p, pct] of Object.entries(byPlan)) {
          const cur = a.byPlan.get(p) ?? 0
          if (pct > cur) a.byPlan.set(p, pct)
        }
        if (snap?.credits?.hasCredits === false) a.exhausted = true
        a.dayCount += 1
      }

      return bucketKeys.map(bk => {
        const a = agg.get(bk)!
        return {
          bucket: bk,
          // Empty bucket: every plan-segment column ends up at zero
          // height, secondary null so the line breaks. The X-axis
          // tick still renders, keeping bar widths consistent across
          // sparse ranges.
          primaryPct: a.primary,
          secondaryPct: a.dayCount === 0 ? null : a.secondary,
          byPlan: Object.fromEntries(a.byPlan),
          creditsExhausted: a.exhausted,
          dayCount: a.dayCount,
        }
      })
    })(),
    series,
    models: modelTotals.map(m => ({
      name: m.name, calls: m.calls, cost: roundUsd(m.cost),
      inputTokens: m.input_tokens, outputTokens: m.output_tokens,
      cacheRead: m.cache_read, cacheWrite: m.cache_write,
    })),
    categories: categoryTotals.map(c => ({ name: c.name, calls: c.calls, cost: roundUsd(c.cost) })),
    projects: projectTotals.map(p => {
      const meta = allProjectMeta[p.name]
      return {
        name: p.name,                              // raw key, used for click-to-drill lookup
        label: meta?.label ?? p.name,              // effective label (custom or auto)
        id: meta?.id ?? null,
        favorite: meta?.favorite ?? false,
        calls: p.calls,
        cost: roundUsd(p.cost),
      }
    }),
    topProjects: topProjectKeys.map(key => {
      const tot = projectTotals.find(p => p.name === key)!
      const meta = projectMeta[key]
      return { key, id: meta?.id ?? null, label: meta?.label ?? key, cost: roundUsd(tot.cost), calls: tot.calls }
    }),
    otherProjects: projectTotals.length > TOP_N_PROJECTS
      ? { count: projectTotals.length - TOP_N_PROJECTS, cost: roundUsd(projectTotals.slice(TOP_N_PROJECTS).reduce((s, p) => s + p.cost, 0)) }
      : { count: 0, cost: 0 },
    agentTelemetry: {
      totals: {
        sessions: agentTotals.sessions ?? 0,
        inputTokens: agentTotals.input_tokens ?? 0,
        cacheCreate: agentTotals.cache_create ?? 0,
        cacheRead: agentTotals.cache_read ?? 0,
        outputTokens: agentTotals.output_tokens ?? 0,
        totalTokens: agentTotals.total_tokens ?? 0,
        cost: roundUsd(agentTotals.cost),
        toolUses: agentTotals.tool_uses ?? 0,
        durationS: agentTotals.duration_s ?? 0,
      },
      byRole: agentByRole.map(r => ({
        role: r.effective_role,
        sessions: r.sessions,
        tokens: r.tokens,
        cost: roundUsd(r.cost),
        toolUses: r.tool_uses,
      })),
      topSessions: agentTopSessions.map(s => ({
        agentId: s.agent_id,
        source: s.source,
        role: s.effective_role,
        rawRole: s.raw_role,
        confidence: s.role_confidence,
        description: s.description,
        tsStart: s.ts_start,
        durationS: s.duration_s,
        totalTokens: s.total_tokens,
        cost: roundUsd(s.cost_usd),
        toolUses: s.tool_uses,
        apiCalls: s.api_calls,
      })),
      timeline: {
        roles: agentRoleNames,
        series: agentTimelineSeries,
      },
      toolSpectrum: {
        topTools: agentTopTools,
        roles: agentToolSpectrum,
      },
      spawnBatches: {
        // Aggregate stats — 0s when no batches at all (all agents
        // were dispatched solo or none in range).
        avgSize: agentBatchAvgRow.avg_size ? Number(agentBatchAvgRow.avg_size.toFixed(1)) : 0,
        maxSize: agentBatchAvgRow.max_size ?? 0,
        batchedAgents: agentBatchAvgRow.batched_agents ?? 0,
        batchCount: agentBatchAvgRow.batch_count ?? 0,
        batches: agentBatchRows.map(r => ({
          promptId: r.prompt_id,
          size: r.batch_size,
          spawnedAt: r.spawned_at,
          cost: roundUsd(r.cost),
          tokens: r.tokens,
          // Roles aggregated from the second query — order by sessions desc
          roles: agentBatchRoles
            .filter(b => b.prompt_id === r.prompt_id)
            .sort((a, b) => b.sessions - a.sessions)
            .map(b => ({ role: b.effective_role, sessions: b.sessions })),
        })),
      },
    },
    lastIngestAt: getMeta('last_ingest_at'),
  })
})

app.get('/api/insights/:projectId', (req, res) => {
  const proj = getProjectById(db(), req.params.projectId)
  if (!proj) return res.status(404).json({ error: 'project not found' })
  const projectKey = proj.key

  const tzMin = parseTzMin(req.query.tzOffsetMin)
  const startRange = localDayRange(req.query.start, tzMin)
  const endRange = localDayRange(req.query.end, tzMin)
  const startEpoch = startRange?.start ?? 0
  const endEpoch = endRange?.end ?? Date.now()
  const providers = normalizeProviders(req.query.providers)
  const provFilter = providerFilterSql(providers)
  // tool_events doesn't carry provider — JOIN api_calls when needed
  const provJoinClause = providers.length > 0
    ? `AND EXISTS (SELECT 1 FROM api_calls ac WHERE ac.dedup_key = tool_events.dedup_key AND ac.provider IN (${providers.map(() => '?').join(',')}))`
    : ''
  const d = db()

  const topByKind = (kind: string, limit = 20) =>
    d.prepare(`
      SELECT value AS name, COUNT(*) AS count, SUM(cost_usd) AS cost
      FROM tool_events
      WHERE project = ? AND kind = ? AND ts_epoch BETWEEN ? AND ? ${provJoinClause}
      GROUP BY value
      ORDER BY count DESC
      LIMIT ?
    `).all(projectKey, kind, startEpoch, endEpoch, ...providers, limit) as Array<{ name: string; count: number; cost: number }>

  // 'subagent' kind in tool_events is still ingested for completeness
  // (a Task() tool call writes one), but the widget that consumed it
  // was retired in v2.4 — agent_sessions is the richer source for
  // anything subagent-related (per-agent costs, tokens, tools, etc.).
  const skills = topByKind('skill', 20)
  const mcp = topByKind('mcp', 20)
  const bash = topByKind('bash', 20)
  const files = topByKind('file', 25)

  const filesUnique = (d.prepare(`
    SELECT COUNT(DISTINCT value) AS n FROM tool_events
    WHERE project = ? AND kind = 'file' AND ts_epoch BETWEEN ? AND ? ${provJoinClause}
  `).get(projectKey, startEpoch, endEpoch, ...providers) as { n: number }).n

  const flags = d.prepare(`
    SELECT
      SUM(has_plan_mode)  AS plan_mode_calls,
      SUM(has_todo_write) AS todo_write_calls,
      COUNT(*)            AS total_calls
    FROM api_calls
    WHERE project = ? AND model_short != '<synthetic>' AND ts_epoch BETWEEN ? AND ? ${provFilter.where}
  `).get(projectKey, startEpoch, endEpoch, ...provFilter.params) as { plan_mode_calls: number; todo_write_calls: number; total_calls: number }

  const branches = d.prepare(`
    SELECT git_branch AS name, COUNT(*) AS calls, SUM(cost_usd) AS cost
    FROM api_calls
    WHERE project = ? AND model_short != '<synthetic>' AND git_branch IS NOT NULL AND git_branch != ''
      AND ts_epoch BETWEEN ? AND ? ${provFilter.where}
    GROUP BY git_branch
    ORDER BY cost DESC
    LIMIT 20
  `).all(projectKey, startEpoch, endEpoch, ...provFilter.params) as Array<{ name: string; calls: number; cost: number }>

  const versions = d.prepare(`
    SELECT cc_version AS name,
           COUNT(*) AS calls,
           SUM(cost_usd) AS cost,
           SUM(input_tokens + output_tokens + cache_read + cache_write) AS tokens,
           MIN(ts) AS first_ts,
           MAX(ts) AS last_ts
    FROM api_calls
    WHERE project = ? AND model_short != '<synthetic>' AND cc_version IS NOT NULL AND cc_version != ''
      AND ts_epoch BETWEEN ? AND ? ${provFilter.where}
    GROUP BY cc_version
    ORDER BY first_ts ASC
  `).all(projectKey, startEpoch, endEpoch, ...provFilter.params) as Array<{ name: string; calls: number; cost: number; tokens: number; first_ts: string; last_ts: string }>

  res.json({
    project: { key: projectKey },
    range: { start: new Date(startEpoch).toISOString(), end: new Date(endEpoch).toISOString(), tzOffsetMin: tzMin },
    skills: skills.map(r => ({ ...r, cost: roundUsd(r.cost) })),
    mcp: mcp.map(r => ({ ...r, cost: roundUsd(r.cost) })),
    bash: bash.map(r => ({ ...r, cost: roundUsd(r.cost) })),
    files: files.map(r => ({ ...r, cost: roundUsd(r.cost) })),
    filesUnique,
    flags,
    branches: branches.map(r => ({ ...r, cost: roundUsd(r.cost) })),
    versions: versions.map(v => ({ ...v, cost: roundUsd(v.cost), tokens: v.tokens ?? 0 })),
  })
})

// ──────────────────────────────────────────────────────────────────────
// Agent registry — per-project classification of discovered raw roles.
// Drives the setup banner and filters the agent-insights widget.
// ──────────────────────────────────────────────────────────────────────

/** Look up a project by :id → key and ensure it exists. 404s consistently. */
function requireProjectKey(req: express.Request, res: express.Response): string | null {
  const id = req.params.projectId
  const proj = getProjectById(db(), id)
  if (!proj) { res.status(404).json({ error: 'project not found' }); return null }
  return proj.key
}

app.get('/api/agents/unclassified-global', (_req, res) => {
  res.json({
    count: countUnclassifiedGlobal(),
    anyConfigured: isAnyProjectConfigured(),
  })
})

app.get('/api/agents/:projectId/detected', (req, res) => {
  const key = requireProjectKey(req, res)
  if (!key) return
  res.json({
    project: { id: req.params.projectId, key },
    detected: listDetectedRoles(key),
    unclassified: countUnclassified(key),
    configured: isProjectConfigured(key),
  })
})

app.get('/api/agents/:projectId/registry', (req, res) => {
  const key = requireProjectKey(req, res)
  if (!key) return
  res.json({ registry: listRegistry(key) })
})

app.put('/api/agents/:projectId/registry/:rawRole', (req, res) => {
  const key = requireProjectKey(req, res)
  if (!key) return
  const rawRole = req.params.rawRole
  if (!rawRole || rawRole.length > 200) {
    return res.status(400).json({ error: 'rawRole must be a non-empty string, <= 200 chars' })
  }
  const body = req.body as { displayName?: string | null; enabled?: boolean; mergedInto?: string | null }
  try {
    const row = upsertRegistry(key, {
      rawRole,
      displayName: body.displayName ?? null,
      enabled: body.enabled,
      mergedInto: body.mergedInto ?? null,
    })
    res.json({ row })
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

app.delete('/api/agents/:projectId/registry/:rawRole', (req, res) => {
  const key = requireProjectKey(req, res)
  if (!key) return
  deleteRegistry(key, req.params.rawRole)
  res.json({ ok: true })
})

app.post('/api/agents/:projectId/registry/acknowledge-all', (req, res) => {
  const key = requireProjectKey(req, res)
  if (!key) return
  const acknowledged = acknowledgeAllUndetected(key)
  res.json({ acknowledged })
})

app.get('/api/health', (_req, res) => {
  // ingestInProgress drives the header spinner / button-state on the
  // client. null when idle; { kind, startedAt } during an ingest
  // (regardless of whether it was triggered manually, by the auto-
  // tick or by Rebuild). Lets the UI distinguish "user clicked
  // Refresh" from "background tick is running" without two separate
  // signals.
  const active = getActiveIngest()
  res.json({
    ok: true,
    lastIngestAt: getMeta('last_ingest_at'),
    ingestInProgress: active
      ? { kind: active.kind, startedAt: new Date(active.startedAt).toISOString() }
      : null,
  })
})

// /api/version reports ONLY what the server learned from GitHub. The
// "current" version and the outdated comparison live entirely on the
// client, which uses its build-time __APP_VERSION__ constant — that's
// the version the user is actually looking at in the browser. Splitting
// "current" between server (reads server/package.json) and client
// (reads client/package.json at Vite build) used to produce mismatched
// UI in dev when one restarted and the other didn't, and would silently
// lie if the two package.json files ever drifted.
app.get('/api/version', (_req, res) => {
  const latest = getLatestRelease()
  const { lastCheckedAt, nextCheckAt } = getCheckState()
  res.json({
    latest: latest?.version ?? null,
    latestUrl: latest?.htmlUrl ?? null,
    latestName: latest?.name ?? null,
    latestPublishedAt: latest?.publishedAt ?? null,
    // lastCheckedAt — tooltip on the up-to-date dot.
    // nextCheckAt   — lets the client schedule its next refetch
    //                 instead of polling at a fixed cadence.
    // (No `checking` field: the spinner is driven by the client's
    // own in-flight state. One request per cycle, no bursts.)
    lastCheckedAt,
    nextCheckAt,
  })
})

// User-controlled settings (gear icon in header). Currently exposes
// only the Updates section; new sections are added by extending
// lib/settings.ts and surfacing them here.
app.get('/api/settings', (_req, res) => {
  // mode: 'dev' lets the client expose sub-hour polling presets
  // (30 s / 1 min / 5 min) for testing. Production builds get the
  // 1 h floor enforced server-side regardless of what the UI sends.
  res.json({ ...getSettings(), mode: IS_DEV ? 'dev' : 'prod' })
})

// Dev-only: seed the version-check cache without hitting GitHub.
// Lets us demo the outdated / up-to-date / checking UI states
// without burning the unauthenticated 60 req/h rate limit. The 404
// in production keeps the surface area honest — there's no way to
// inject a fake "new version available" signal on real users.
if (IS_DEV) {
  app.post('/api/_dev/seed-version', (req, res) => {
    const body = (req.body ?? {}) as { version?: string | null; name?: string; htmlUrl?: string; publishedAt?: string }
    if (body.version === null) {
      seedLatestRelease(null)
      return res.json({ ok: true, cleared: true })
    }
    if (typeof body.version !== 'string' || !body.version.match(/^\d+\.\d+\.\d+/)) {
      return res.status(400).json({ error: 'version must be "X.Y.Z" or null' })
    }
    seedLatestRelease({ version: body.version, name: body.name, htmlUrl: body.htmlUrl, publishedAt: body.publishedAt })
    res.json({ ok: true, latest: getLatestRelease() })
  })
}

app.patch('/api/settings', (req, res) => {
  const body = (req.body ?? {}) as {
    updates?: Partial<{ enabled: boolean; intervalSeconds: number }>
    ingest?: Partial<{ enabled: boolean; intervalSeconds: number }>
  }
  if (body.updates) {
    patchUpdates(body.updates)
    // Settings drive the version-check loop directly — apply them now
    // so the user never has to restart the server (or wait an interval
    // for the change to take effect).
    applyVersionCheckSettings()
  }
  if (body.ingest) {
    patchIngest(body.ingest)
    // Auto-ingest scheduler is restartable: start/stop the timer or
    // change its cadence to match the new settings without a server
    // restart. See lib/auto-ingest.ts.
    applyAutoIngestSettings()
  }
  res.json({ ...getSettings(), mode: IS_DEV ? 'dev' : 'prod' })
})

const clientDistCandidates = [
  join(__dirname, '..', 'client', 'dist'),
  join(__dirname, 'public'),
]
for (const dist of clientDistCandidates) {
  if (existsSync(dist) && statSync(dist).isDirectory()) {
    console.log(`[static] serving client from ${dist}`)
    app.use(express.static(dist))
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')))
    break
  }
}

const port = Number(process.env.PORT ?? 4317)

async function boot() {
  // Background poll of GitHub Releases — first hit lands ~30s after
  // boot, then every 6h. Failures keep the cache stale, never crash.
  startVersionCheck()
  const d = db()
  // Warm SQLite's page cache so the first user request doesn't eat a
  // 5–15 second cold-query hit. Cost: ~50 ms of extra boot latency for a
  // 33k-row db; benefit: `/api/projects` (LEFT JOIN + GROUP BY on the
  // whole api_calls table) and `/api/insights/:id` (multi-way aggregate
  // on tool_events + api_calls) return immediately on the first click
  // instead of leaving the UI spinning. Touching every page with a
  // trivial COUNT query is enough — WAL + mmap mean subsequent real
  // queries hit memory rather than disk. */
  try {
    d.prepare('SELECT COUNT(*) FROM api_calls').get()
    d.prepare('SELECT COUNT(*) FROM tool_events').get()
  } catch { /* empty DB on first start — no-op */ }
  const last = getMeta('last_ingest_at')
  if (!last) {
    console.log('[ingest] empty DB, running initial ingest…')
    // Initial bootstrap goes through the lock too — a clever user
    // could hammer /api/refresh during boot before this finishes
    // and we'd have two parallel scans of an empty DB. Cheap to
    // guard, no downside.
    const { result } = await withIngestLock('full', 'dedup', () => runIngest())
    console.log('[ingest]', result)
  } else {
    console.log(`[ingest] last ingest: ${last}`)
  }

  // Legacy env-driven auto-ingest. Kept for users who configure
  // their server via THIRD_EYE_INGEST_INTERVAL_MIN at the container
  // level (e.g. systemd / Docker). This runs IN ADDITION to the
  // settings-driven auto-tick — both go through the lock with dedup
  // policy, so overlap is harmless. New users should prefer the UI
  // toggle (Settings → Auto-refresh).
  //
  // Deprecated as of 2.6.0; planned removal in 3.0. We log a
  // one-shot warning at boot when the env var is set so operators
  // see the deprecation in their container logs without breaking
  // anything that's currently working.
  const intervalMin = envReadNumber('THIRD_EYE_INGEST_INTERVAL_MIN', 'CODEBURN_INGEST_INTERVAL_MIN') ?? 0
  const intervalSince = envRead('THIRD_EYE_INGEST_SINCE', 'CODEBURN_INGEST_SINCE') ?? '2h'
  if (intervalMin > 0) {
    console.warn('[ingest] DEPRECATED: THIRD_EYE_INGEST_INTERVAL_MIN will be removed in 3.0.')
    console.warn('[ingest] Migrate to Settings → Auto-refresh (or PATCH /api/settings ingest=...) instead.')
    console.log(`[ingest] env-driven auto-refresh every ${intervalMin}m (since=${intervalSince})`)
    setInterval(() => {
      withIngestLock('incremental', 'dedup', () => runIngest({ since: intervalSince }))
        .then(({ result, deduped }) => console.log('[ingest:auto:env]', {
          mode: result.mode, total: result.total, durationMs: result.durationMs, deduped,
        }))
        .catch(err => console.error('[ingest:auto:env] failed:', err.message))
    }, intervalMin * 60_000)
  }

  // Settings-driven auto-tick. Reads the persisted ingest section
  // and starts a timer if enabled; the same call from the
  // /api/settings PATCH handler restarts the timer when the user
  // changes interval or toggles the feature. Off by default — user
  // opts in.
  applyAutoIngestSettings()

  // Bind to loopback by default — the server reads your session data, so it should not be LAN-accessible
  // without intent. Override via THIRD_EYE_HOST=0.0.0.0 for Docker / container scenarios.
  // Legacy CODEBURN_HOST still honored (see server/lib/env.ts).
  const host = envRead('THIRD_EYE_HOST', 'CODEBURN_HOST') ?? '127.0.0.1'
  const server = app.listen(port, host, () => console.log(`Third Eye server on http://${host}:${port}`))

  // Keep-alive tuning. Node's default keepAliveTimeout is 5s, but browsers
  // reuse keep-alive sockets for much longer. After 5s of idle the server
  // FINs the socket; the browser doesn't notice until it tries to send the
  // next request, which then hangs (visible as "pending" in DevTools) until
  // the client-side timeout. Bumping to 65s matches the de-facto industry
  // standard (AWS ALB / nginx). headersTimeout must be > keepAliveTimeout
  // or Node's own check fires first and aborts in-flight requests.
  server.keepAliveTimeout = 65_000
  server.headersTimeout = 66_000

  // Graceful shutdown: close the listening socket before exiting so the OS
  // releases the port immediately. Without this, `tsx watch` restarts on
  // file change hit EADDRINUSE for ~30–60s until the kernel reclaims the
  // socket — which kills `tsx watch`, which kills Vite (concurrently's
  // --kill-others-on-fail), leaving the user with a dead dev session.
  const shutdown = () => server.close(() => process.exit(0))
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

boot().catch(err => { console.error(err); process.exit(1) })
