import express from 'express'
import cors from 'cors'
import { existsSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { db, getMeta } from './db.ts'
import { runIngest } from './ingest.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

type Granularity = 'day' | 'week' | 'month'

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

function bucketSql(g: Granularity, tzMin: number, weekStartsOn: number): string {
  const sign = tzMin >= 0 ? '+' : '-'
  const tz = `'${sign}${Math.abs(tzMin)} minutes'`
  if (g === 'month') return `strftime('%Y-%m', datetime(ts, ${tz}))`
  if (g === 'week') {
    // end-of-week weekday = the day BEFORE the week's first day.
    // SQLite 'weekday N' advances to the next occurrence of weekday N (0=Sun..6=Sat);
    // then -6 days gives the start of the week containing the date.
    const endOfWeek = (weekStartsOn + 6) % 7
    return `strftime('%Y-%m-%d', date(ts, ${tz}, 'weekday ${endOfWeek}', '-6 days'))`
  }
  return `strftime('%Y-%m-%d', datetime(ts, ${tz}))`
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

  if (g === 'day') {
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
// Override via CODEBURN_CORS_ORIGIN="https://your.host" if you ever expose this publicly (not recommended).
const corsOrigin = process.env.CODEBURN_CORS_ORIGIN ?? ['http://localhost:5173', 'http://127.0.0.1:5173']
app.use(cors({ origin: corsOrigin }))
app.use(express.json())

const PROVIDER_DISPLAY: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex (OpenAI)',
}

app.get('/api/projects', (_req, res) => {
  const rows = db().prepare(`
    SELECT p.id, p.key, p.label,
           COUNT(c.dedup_key) AS calls,
           COALESCE(SUM(c.cost_usd), 0) AS cost,
           MIN(c.ts) AS first_ts,
           MAX(c.ts) AS last_ts
    FROM projects p
    LEFT JOIN api_calls c ON c.project = p.key AND c.model_short != '<synthetic>'
    GROUP BY p.id
    HAVING calls > 0
    ORDER BY cost DESC
  `).all() as Array<{ id: string; key: string; label: string | null; calls: number; cost: number; first_ts: string; last_ts: string }>
  res.json({
    projects: rows.map(r => ({
      id: r.id, key: r.key, label: r.label ?? r.key,
      calls: r.calls, cost: Number(r.cost.toFixed(4)),
      firstTs: r.first_ts, lastTs: r.last_ts,
    })),
  })
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
      cost: Number((r.cost ?? 0).toFixed(4)),
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
    const row = db().prepare('SELECT id, key, label FROM projects WHERE id = ?').get(projectIdRaw) as { id: string; key: string; label: string | null } | undefined
    if (row) { projectId = row.id; projectKey = row.key; projectLabel = row.label }
  } else if (projectKeyRaw) {
    const row = db().prepare('SELECT id, key, label FROM projects WHERE key = ?').get(projectKeyRaw) as { id: string; key: string; label: string | null } | undefined
    if (row) { projectId = row.id; projectKey = row.key; projectLabel = row.label }
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

  const projectTotals = d.prepare(`
    SELECT project AS name, COUNT(*) AS calls, SUM(cost_usd) AS cost
    FROM api_calls
    WHERE ts_epoch BETWEEN ? AND ? AND model_short != '<synthetic>' ${providerFilter.where} ${projectFilter.where}
    GROUP BY project
    ORDER BY cost DESC
    LIMIT 30
  `).all(...baseParams) as Array<{ name: string; calls: number; cost: number }>

  // Per-project per-bucket breakdown for the new "Work by project" stacked chart.
  // Top N by cost in current range, rest aggregated as "__other".
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
  // Resolve project labels + ids (for click-to-drill) in one lookup.
  const projectMeta: Record<string, { label: string; id: string | null }> = {}
  if (topProjectKeys.length > 0) {
    const placeholders = topProjectKeys.map(() => '?').join(',')
    const rows = d.prepare(`SELECT key, id, label FROM projects WHERE key IN (${placeholders})`).all(...topProjectKeys) as Array<{ key: string; id: string; label: string | null }>
    for (const r of rows) projectMeta[r.key] = { label: r.label ?? r.key, id: r.id }
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

  const series = bucketKeys.map(k => {
    const s = seriesMap.get(k)
    const row: Record<string, number | string> = {
      bucket: k,
      cost: Number((s?.cost ?? 0).toFixed(4)),
      calls: s?.calls ?? 0,
      inputTokens: s?.input_tokens ?? 0,
      outputTokens: s?.output_tokens ?? 0,
      cacheRead: s?.cache_read ?? 0,
      cacheWrite: s?.cache_write ?? 0,
    }
    const mb = modelByBucket.get(k)
    for (const m of topModels) row[`model:${m}`] = Number((mb?.get(m) ?? 0).toFixed(4))
    const pb = projectByBucket.get(k)
    for (const key of topProjectKeys) row[`project:${key}`] = Number((pb?.get(key) ?? 0).toFixed(4))
    row['project:__other'] = Number((pb?.get('__other') ?? 0).toFixed(4))
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
      cost: Number((totals.cost ?? 0).toFixed(4)),
      calls: totals.calls ?? 0,
      inputTokens: totals.input_tokens ?? 0,
      outputTokens: totals.output_tokens ?? 0,
      cacheRead: totals.cache_read ?? 0,
      cacheWrite: totals.cache_write ?? 0,
      projects: totals.projects ?? 0,
    },
    series,
    models: modelTotals.map(m => ({
      name: m.name, calls: m.calls, cost: Number(m.cost.toFixed(4)),
      inputTokens: m.input_tokens, outputTokens: m.output_tokens,
      cacheRead: m.cache_read, cacheWrite: m.cache_write,
    })),
    categories: categoryTotals.map(c => ({ name: c.name, calls: c.calls, cost: Number(c.cost.toFixed(4)) })),
    projects: projectTotals.map(p => ({ name: p.name, calls: p.calls, cost: Number(p.cost.toFixed(4)) })),
    topProjects: topProjectKeys.map(key => {
      const tot = projectTotals.find(p => p.name === key)!
      const meta = projectMeta[key]
      return { key, id: meta?.id ?? null, label: meta?.label ?? key, cost: Number(tot.cost.toFixed(4)), calls: tot.calls }
    }),
    otherProjects: projectTotals.length > TOP_N_PROJECTS
      ? { count: projectTotals.length - TOP_N_PROJECTS, cost: Number(projectTotals.slice(TOP_N_PROJECTS).reduce((s, p) => s + p.cost, 0).toFixed(4)) }
      : { count: 0, cost: 0 },
    lastIngestAt: getMeta('last_ingest_at'),
  })
})

app.get('/api/insights/:projectId', (req, res) => {
  const proj = db().prepare('SELECT key FROM projects WHERE id = ?').get(req.params.projectId) as { key: string } | undefined
  if (!proj) return res.status(404).json({ error: 'project not found' })
  const projectKey = proj.key

  const tzMin = parseTzMin(req.query.tzOffsetMin)
  const startRange = localDayRange(req.query.start, tzMin)
  const endRange = localDayRange(req.query.end, tzMin)
  const startEpoch = startRange?.start ?? 0
  const endEpoch = endRange?.end ?? Date.now()
  const tzSign = tzMin >= 0 ? '+' : '-'
  const tzShift = `'${tzSign}${Math.abs(tzMin)} minutes'`
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

  // 24x7 hour-of-week heatmap, shifted to client's local timezone.
  const heatmapRows = d.prepare(`
    SELECT CAST(strftime('%w', ts, ${tzShift}) AS INTEGER) AS dow,
           CAST(strftime('%H', ts, ${tzShift}) AS INTEGER) AS hour,
           COUNT(*) AS calls,
           SUM(cost_usd) AS cost
    FROM api_calls
    WHERE project = ? AND model_short != '<synthetic>' AND ts_epoch BETWEEN ? AND ? ${provFilter.where}
    GROUP BY dow, hour
  `).all(projectKey, startEpoch, endEpoch, ...provFilter.params) as Array<{ dow: number; hour: number; calls: number; cost: number }>

  res.json({
    project: { key: projectKey },
    range: { start: new Date(startEpoch).toISOString(), end: new Date(endEpoch).toISOString(), tzOffsetMin: tzMin },
    subagents: subagents.map(r => ({ ...r, cost: Number(r.cost.toFixed(4)) })),
    skills: skills.map(r => ({ ...r, cost: Number(r.cost.toFixed(4)) })),
    mcp: mcp.map(r => ({ ...r, cost: Number(r.cost.toFixed(4)) })),
    bash: bash.map(r => ({ ...r, cost: Number(r.cost.toFixed(4)) })),
    files: files.map(r => ({ ...r, cost: Number(r.cost.toFixed(4)) })),
    filesUnique,
    flags,
    branches: branches.map(r => ({ ...r, cost: Number(r.cost.toFixed(4)) })),
    versions: versions.map(v => ({ ...v, cost: Number(v.cost.toFixed(4)), tokens: v.tokens ?? 0 })),
    heatmap: heatmapRows,
  })
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
  db()
  const last = getMeta('last_ingest_at')
  if (!last) {
    console.log('[ingest] empty DB, running initial ingest…')
    const stats = await runIngest()
    console.log('[ingest]', stats)
  } else {
    console.log(`[ingest] last ingest: ${last}`)
  }

  const intervalMin = Number(process.env.CODEBURN_INGEST_INTERVAL_MIN ?? 0)
  const intervalSince = process.env.CODEBURN_INGEST_SINCE ?? '2h'
  if (intervalMin > 0) {
    console.log(`[ingest] auto-refresh every ${intervalMin}m (since=${intervalSince})`)
    setInterval(() => {
      runIngest({ since: intervalSince })
        .then(s => console.log('[ingest:auto]', { mode: s.mode, total: s.total, durationMs: s.durationMs }))
        .catch(err => console.error('[ingest:auto] failed:', err.message))
    }, intervalMin * 60_000)
  }

  // Bind to loopback by default — the server reads your session data, so it should not be LAN-accessible
  // without intent. Override via CODEBURN_HOST=0.0.0.0 for Docker / container scenarios.
  const host = process.env.CODEBURN_HOST ?? '127.0.0.1'
  app.listen(port, host, () => console.log(`Third Eye server on http://${host}:${port}`))
}

boot().catch(err => { console.error(err); process.exit(1) })
