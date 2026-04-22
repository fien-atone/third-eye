import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const DB_PATH = process.env.CODEBURN_DB ?? join(__dirname, '..', 'data', 'codeburn.db')

let _db: Database.Database | null = null

export function db(): Database.Database {
  if (_db) return _db
  mkdirSync(dirname(DB_PATH), { recursive: true })
  _db = new Database(DB_PATH)
  _db.pragma('journal_mode = WAL')
  _db.pragma('synchronous = NORMAL')
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

  // Idempotent column additions (SQLite has no IF NOT EXISTS for columns)
  const addCol = (sql: string) => {
    try { d.exec(sql) } catch (e) {
      if (!String((e as Error).message).includes('duplicate column')) throw e
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
}

export function truncateAll(): { calls: number; projects: number } {
  const d = db()
  const calls = (d.prepare('SELECT COUNT(*) AS n FROM api_calls').get() as { n: number }).n
  const projects = (d.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }).n
  d.exec('DELETE FROM api_calls; DELETE FROM tool_events; DELETE FROM projects; DELETE FROM meta WHERE key LIKE \'last_ingest%\';')
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
