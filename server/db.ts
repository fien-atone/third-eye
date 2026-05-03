import Database from 'better-sqlite3'
import { existsSync, mkdirSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { envRead } from './lib/env.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Resolve the default DB path for in-tree installs. Autodetects a pre-
 *  existing `codeburn.db` (from before the CodeBurn→third-eye rename)
 *  so upgrading users keep their history without touching anything.
 *  When no DB exists yet, always creates the new `third-eye.db`.
 *  An explicit env override (THIRD_EYE_DB / CODEBURN_DB) wins over both. */
function resolveDefaultDbPath(): string {
  const dataDir = join(__dirname, '..', 'data')
  const newPath = join(dataDir, 'third-eye.db')
  const legacyPath = join(dataDir, 'codeburn.db')
  // Prefer the legacy file whenever it has actual data — the new
  // path may exist as an empty placeholder (Docker test runs create
  // one on a fresh data volume; our own dev runs can too if the user
  // wipes the new DB without removing the legacy one). Without this
  // size check the auto-detect would silently switch to a 0-byte
  // file and the UI would look empty.
  const legacyHasData = existsSync(legacyPath) && statSync(legacyPath).size > 0
  const newHasData = existsSync(newPath) && statSync(newPath).size > 0
  if (legacyHasData && !newHasData) return legacyPath
  return newPath
}

export const DB_PATH = envRead('THIRD_EYE_DB', 'CODEBURN_DB') ?? resolveDefaultDbPath()

let _db: Database.Database | null = null

export function db(): Database.Database {
  if (_db) return _db
  mkdirSync(dirname(DB_PATH), { recursive: true })
  _db = new Database(DB_PATH)
  _db.pragma('journal_mode = WAL')
  _db.pragma('synchronous = NORMAL')
  // Perf pragmas: on a cold DB the first heavy insights/overview query
  // (GROUP BY / aggregate on 33k-row api_calls + tool_events joins) used
  // to take 5–10 s while SQLite loaded pages from disk one-by-one. Memory-
  // mapping the DB (up to 256 MiB — easily covers the whole thing) lets
  // the OS page-cache do the work, dropping cold queries to <100 ms.
  // cache_size in negative KiB = ~64 MiB, so the working set stays in
  // SQLite's own page cache between requests without fighting the OS.
  _db.pragma('mmap_size = 268435456')   // 256 MiB
  _db.pragma('cache_size = -65536')     // 64 MiB
  _db.pragma('temp_store = MEMORY')
  migrate(_db)
  return _db
}

function migrate(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS api_calls (
      dedup_key    TEXT PRIMARY KEY,
      ts           TEXT NOT NULL,
      ts_epoch     INTEGER NOT NULL,
      provider     TEXT NOT NULL,
      model        TEXT NOT NULL,
      model_short  TEXT NOT NULL,
      project      TEXT NOT NULL,
      session_id   TEXT NOT NULL,
      category     TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cache_read   INTEGER NOT NULL,
      cache_write  INTEGER NOT NULL,
      web_search   INTEGER NOT NULL,
      cost_usd     REAL NOT NULL,
      speed        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_calls_ts       ON api_calls(ts_epoch);
    CREATE INDEX IF NOT EXISTS idx_calls_provider ON api_calls(provider);
    CREATE INDEX IF NOT EXISTS idx_calls_model    ON api_calls(model_short);
    CREATE INDEX IF NOT EXISTS idx_calls_project  ON api_calls(project);

    CREATE TABLE IF NOT EXISTS projects (
      id     TEXT PRIMARY KEY,
      key    TEXT UNIQUE NOT NULL,
      label  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_projects_key ON projects(key);

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tool_events (
      dedup_key TEXT NOT NULL,
      ts_epoch  INTEGER NOT NULL,
      project   TEXT NOT NULL,
      kind      TEXT NOT NULL,
      value     TEXT NOT NULL,
      cost_usd  REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_tool_events_project ON tool_events(project, kind);
    CREATE INDEX IF NOT EXISTS idx_tool_events_ts      ON tool_events(ts_epoch);
    CREATE INDEX IF NOT EXISTS idx_tool_events_dedup   ON tool_events(dedup_key);
  `)

  // Idempotent column additions (SQLite has no IF NOT EXISTS for columns).
  // Two errors are swallowed silently:
  //   - "duplicate column" — column already exists, expected on every
  //     run after the first.
  //   - "no such table"    — migration ordering accident: a future
  //     change might place an addCol() above its CREATE TABLE; we'd
  //     rather skip the alter and surface the missing column at use
  //     time than abort the entire migration on a fresh DB.
  const addCol = (sql: string) => {
    try { d.exec(sql) } catch (e) {
      const msg = String((e as Error).message)
      if (msg.includes('duplicate column') || msg.includes('no such table')) return
      throw e
    }
  }
  addCol("ALTER TABLE api_calls ADD COLUMN git_branch TEXT")
  addCol("ALTER TABLE api_calls ADD COLUMN cc_version TEXT")
  addCol("ALTER TABLE api_calls ADD COLUMN has_plan_mode INTEGER NOT NULL DEFAULT 0")
  addCol("ALTER TABLE api_calls ADD COLUMN has_todo_write INTEGER NOT NULL DEFAULT 0")
  addCol("ALTER TABLE api_calls ADD COLUMN file_count INTEGER NOT NULL DEFAULT 0")

  // User-editable project metadata
  addCol("ALTER TABLE projects ADD COLUMN custom_label TEXT")
  addCol("ALTER TABLE projects ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0")

  // Per-screen widget layouts. layout_json shape matches the ScreenLayout
  // type in server/lib/default-layouts.ts. Defaults are seeded by
  // seedScreenLayouts() below — only on first start, never overwriting
  // existing rows.
  d.exec(`CREATE TABLE IF NOT EXISTS screen_layouts (
    screen TEXT PRIMARY KEY,
    layout_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)

  // Per-agent-invocation telemetry. One row = one spawned agent session
  // (subagent or Task tool output). Populated by server/lib/agent-sessions.ts
  // during ingest. Primary key is (source, project, agent_id) so re-ingest
  // is idempotent — the same JSONL file always maps to the same row.
  d.exec(`CREATE TABLE IF NOT EXISTS agent_sessions (
    agent_id            TEXT NOT NULL,
    source              TEXT NOT NULL,  -- 'subagent' | 'task'
    project             TEXT NOT NULL,
    ts_start            TEXT NOT NULL,
    ts_start_epoch      INTEGER NOT NULL,
    duration_s          INTEGER NOT NULL,
    role                TEXT NOT NULL,
    role_confidence     TEXT NOT NULL,  -- 'meta' | 'prompt' | 'unknown'
    description         TEXT NOT NULL,
    model               TEXT NOT NULL,
    input_tokens        INTEGER NOT NULL,
    cache_create_tokens INTEGER NOT NULL,
    cache_read_tokens   INTEGER NOT NULL,
    output_tokens       INTEGER NOT NULL,
    total_tokens        INTEGER NOT NULL,
    cost_usd            REAL NOT NULL,
    api_calls           INTEGER NOT NULL,
    tool_uses           INTEGER NOT NULL,
    tools_json          TEXT NOT NULL,
    PRIMARY KEY (source, project, agent_id)
  );
  CREATE INDEX IF NOT EXISTS idx_agent_sessions_project ON agent_sessions(project);
  CREATE INDEX IF NOT EXISTS idx_agent_sessions_ts      ON agent_sessions(ts_start_epoch);
  CREATE INDEX IF NOT EXISTS idx_agent_sessions_role    ON agent_sessions(role);
  `)

  // Agent-session enrichment fields (added in v2.4). MUST run AFTER
  // the CREATE TABLE above — addCol on a missing table aborts the
  // whole migration on a fresh DB (caught during a Docker smoke run).
  // `prompt_id`  — Claude's parent prompt UUID that spawned this
  //                agent. Multiple agents sharing it = one parallel
  //                batch dispatch.
  // `stop_reason` — final assistant turn's stop_reason. end_turn =
  //                clean exit; tool_use last = aborted mid-tool;
  //                max_tokens = context limit. "Agent health" signal.
  addCol("ALTER TABLE agent_sessions ADD COLUMN prompt_id TEXT")
  addCol("ALTER TABLE agent_sessions ADD COLUMN stop_reason TEXT")

  // Per-project agent-role registry. Rows are created by the user via
  // the Agents Setup modal — one row per detected raw-role value the
  // user has explicitly acknowledged. raw_role is the key extracted by
  // the parser (meta-prefix or "You are the X" match). display_name
  // lets the user rename for UI; when merged_into is set the role is
  // treated as an alias of another (rollup target). enabled=0 means
  // the role is acknowledged but should be collapsed into the
  // "Unclassified" bucket in views. Any raw role NOT in this table
  // counts as "undetected-but-present" and drives the setup banner.
  d.exec(`CREATE TABLE IF NOT EXISTS agent_registry (
    project       TEXT NOT NULL,
    raw_role      TEXT NOT NULL,
    display_name  TEXT,
    enabled       INTEGER NOT NULL DEFAULT 1,
    merged_into   TEXT,
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (project, raw_role)
  );
  CREATE INDEX IF NOT EXISTS idx_agent_registry_project ON agent_registry(project);
  `)

  // User-controlled settings (versioned via key/value JSON so adding a
  // new field doesn't need a migration). One key per top-level section
  // — `lib/settings.ts` reads/writes typed objects.
  d.exec(`CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`)

  // Per-day Codex plan-usage peaks. One row per local-tz day (matching
  // the YYYY/MM/DD directory layout Codex itself uses). primary_pct is
  // the maximum used_percent observed across all rate_limits samples
  // on that day; the full snapshot stores the captured-at sample so
  // the widget can show plan name, secondary window, reset countdown,
  // etc. Rebuilt during ingest from the rollout files. Lets the Today
  // view show that day's peak when navigating to past dates rather
  // than always reading the latest sample (which would be wrong for
  // every day except today). See lib/providers/codex.ts.
  d.exec(`CREATE TABLE IF NOT EXISTS codex_plan_daily (
    day            TEXT PRIMARY KEY,    -- YYYY-MM-DD (Codex sessions dir day)
    primary_pct    REAL NOT NULL,
    secondary_pct  REAL NOT NULL,
    snapshot       TEXT NOT NULL,        -- JSON CodexPlanSnapshot at peak primary
    updated_at     TEXT NOT NULL
  )`)

  // by_plan_json — peak primary % keyed by plan_type for the day, e.g.
  // {"free":30,"plus":98}. Drives the Dashboard's stacked-bar history
  // widget (each plan = its own colored segment). Optional column,
  // added after the table existed in the wild — older rows have NULL
  // and the widget falls back to a single-segment bar coloured by the
  // snapshot's planType.
  addCol("ALTER TABLE codex_plan_daily ADD COLUMN by_plan_json TEXT")
}

/** Seed default layouts on first startup. Idempotent: INSERT OR IGNORE
 *  leaves user customizations untouched on subsequent starts. */
export function seedScreenLayouts(defaults: Record<string, unknown>) {
  const d = db()
  const now = new Date().toISOString()
  const stmt = d.prepare('INSERT OR IGNORE INTO screen_layouts (screen, layout_json, updated_at) VALUES (?, ?, ?)')
  for (const [screen, layout] of Object.entries(defaults)) {
    stmt.run(screen, JSON.stringify(layout), now)
  }
}

/** What a Rebuild operation should wipe. The telemetry tables
 *  (`api_calls`, `tool_events`, `agent_sessions`, `codex_plan_daily`)
 *  always go — that's what "rebuild from session files" means.
 *  The optional flags expose user-configured tables; default false
 *  so a generic Rebuild call preserves everything the user spent
 *  time setting up.
 *
 *  Earlier versions (≤2.6.0) silently included `projects` and
 *  `agent_registry` in the always-wipe list, nuking favorites and
 *  custom role display names on every Rebuild. The Settings UI now
 *  asks the user which optional categories to include, defaulting
 *  to "telemetry only" — this type is what flows through. */
export type RebuildTargets = {
  /** Wipe `projects` rows (favorites + custom labels). The next
   *  ingest's upsert re-creates rows for projects still on disk,
   *  but with default auto-derived labels and is_favorite=0. */
  resetProjects?: boolean
  /** Wipe `agent_registry` (per-project agent role display names,
   *  enabled flags, merged_into mappings). Manage Agents starts
   *  fresh; raw role strings still come back from the next ingest
   *  but the user has to re-classify. */
  resetAgents?: boolean
  /** Wipe `screen_layouts`. Reverts every screen to the seeded
   *  default layout. Settings.* (auto-refresh, version polling)
   *  is NOT included here — that's `resetSettings` (not yet
   *  exposed; would only make sense as a separate self-destruct
   *  button). */
  resetLayouts?: boolean
}

export function truncateAll(targets: RebuildTargets = {}): { calls: number; projects: number } {
  const d = db()
  const calls = (d.prepare('SELECT COUNT(*) AS n FROM api_calls').get() as { n: number }).n
  const projects = (d.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }).n
  // Always wipe telemetry — that's the whole point of Rebuild.
  // Each statement independent so a future schema mishap on one
  // table doesn't abort the rest.
  d.exec(`
    DELETE FROM api_calls;
    DELETE FROM tool_events;
    DELETE FROM agent_sessions;
    DELETE FROM codex_plan_daily;
    DELETE FROM meta WHERE key LIKE 'last_ingest%' OR key LIKE 'codex_plan%';
  `)
  if (targets.resetProjects) d.exec('DELETE FROM projects;')
  if (targets.resetAgents) d.exec('DELETE FROM agent_registry;')
  if (targets.resetLayouts) d.exec('DELETE FROM screen_layouts;')
  d.exec('VACUUM')
  return { calls, projects }
}

export function setMeta(key: string, value: string) {
  db().prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value)
}

export function getMeta(key: string): string | null {
  const row = db().prepare('SELECT value FROM meta WHERE key=?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export type CallRow = {
  dedup_key: string
  ts: string
  ts_epoch: number
  provider: string
  model: string
  model_short: string
  project: string
  session_id: string
  category: string
  input_tokens: number
  output_tokens: number
  cache_read: number
  cache_write: number
  web_search: number
  cost_usd: number
  speed: string
}
