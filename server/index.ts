import express from 'express'
import cors from 'cors'
import { existsSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { db, getMeta, seedScreenLayouts } from './db.ts'
import { runIngest } from './ingest.ts'
import { DEFAULT_LAYOUTS, KNOWN_SCREENS, type ScreenLayout } from './lib/default-layouts.ts'
import { envRead, envReadNumber } from './lib/env.ts'
import {
  countUnclassified, countUnclassifiedGlobal, listDetectedRoles,
  listRegistry, upsertRegistry, deleteRegistry, acknowledgeAllUndetected,
  isProjectConfigured, isAnyProjectConfigured,
} from './lib/agent-registry.ts'

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
  try {
    const since = typeof req.query.since === 'string' ? req.query.since : undefined
    const full = req.query.full === 'true' || req.query.full === '1'
    const stats = await runIngest({ since, full })
    res.json({ ok: true, ...stats })
  } catch (err) {
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
           COUNT(DISTINCT project) AS projects
    FROM api_calls
    WHERE ts_epoch BETWEEN ? AND ? AND model_short != '<synthetic>' ${providerFilter.where} ${projectFilter.where}
  `).get(...baseParams) as {
    cost: number | null; calls: number; input_tokens: number | null; output_tokens: number | null;
    cache_read: number | null; cache_write: number | null; projects: number;
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

  const agentTotals = d.prepare(`
    SELECT COUNT(*) AS sessions,
           COALESCE(SUM(s.input_tokens), 0)        AS input_tokens,
           COALESCE(SUM(s.cache_create_tokens), 0) AS cache_create,
           COALESCE(SUM(s.cache_read_tokens), 0)   AS cache_read,
           COALESCE(SUM(s.output_tokens), 0)       AS output_tokens,
           COALESCE(SUM(s.total_tokens), 0)        AS total_tokens,
           COALESCE(SUM(s.cost_usd), 0)            AS cost,
           COALESCE(SUM(s.tool_uses), 0)           AS tool_uses,
           COALESCE(SUM(s.duration_s), 0)          AS duration_s
    ${agentFromClause}
    WHERE s.ts_start_epoch BETWEEN ? AND ? ${agentProjectFilter}
  `).get(...agentParams) as {
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
      cacheWrite: totals.cache_write ?? 0,
      projects: totals.projects ?? 0,
    },
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

  const subagents = topByKind('subagent', 20)
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
    subagents: subagents.map(r => ({ ...r, cost: roundUsd(r.cost) })),
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

app.get('/api/health', (_req, res) => res.json({ ok: true, lastIngestAt: getMeta('last_ingest_at') }))

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
    const stats = await runIngest()
    console.log('[ingest]', stats)
  } else {
    console.log(`[ingest] last ingest: ${last}`)
  }

  const intervalMin = envReadNumber('THIRD_EYE_INGEST_INTERVAL_MIN', 'CODEBURN_INGEST_INTERVAL_MIN') ?? 0
  const intervalSince = envRead('THIRD_EYE_INGEST_SINCE', 'CODEBURN_INGEST_SINCE') ?? '2h'
  if (intervalMin > 0) {
    console.log(`[ingest] auto-refresh every ${intervalMin}m (since=${intervalSince})`)
    setInterval(() => {
      runIngest({ since: intervalSince })
        .then(s => console.log('[ingest:auto]', { mode: s.mode, total: s.total, durationMs: s.durationMs }))
        .catch(err => console.error('[ingest:auto] failed:', err.message))
    }, intervalMin * 60_000)
  }

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
