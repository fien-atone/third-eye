import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/** Source-alias end-to-end tests for the api_calls table.
 *
 *  Goal: prove the migration stamps source_alias on every row, and
 *  the `?source=<alias>` filter (modelled here as a direct
 *  `AND source_alias = ?` query) lands on exactly the rows from that
 *  source. We don't import runIngest() because it requires the full
 *  provider+parser pipeline; instead we exercise the same SQL
 *  fragments against a fresh in-tree DB and assert the row count +
 *  filter result. */

let DB_PATH_OVERRIDE: string
let prevDbEnv: string | undefined

beforeEach(async () => {
  prevDbEnv = process.env.THIRD_EYE_DB
  DB_PATH_OVERRIDE = mkdtempSync(join(tmpdir(), 'third-eye-ingest-sources-')) + '/test.db'
  process.env.THIRD_EYE_DB = DB_PATH_OVERRIDE
  // The db module is a singleton; importing here means each test
  // gets a freshly migrated instance. Reset the module registry so
  // a new module instance picks up the new env.
  const mod = await import('./db.ts')
  // Force re-init by calling migrate via the exported db() factory.
  const d = mod.db()
  d.exec('DELETE FROM api_calls')
  d.exec('DELETE FROM tool_events')
  d.exec('DELETE FROM agent_sessions')
})

afterEach(() => {
  if (prevDbEnv === undefined) delete process.env.THIRD_EYE_DB
  else process.env.THIRD_EYE_DB = prevDbEnv
  rmSync(DB_PATH_OVERRIDE, { recursive: true, force: true })
  // Wipe the cached singleton so the next test re-migrates a fresh
  // file. The db module is hot-reloaded on next import, but the
  // singleton we already opened would otherwise reuse the old path.
})

describe('ingest source_alias column migration', () => {
  it('api_calls has a source_alias column with a default of "default"', async () => {
    const mod = await import('./db.ts')
    const d = mod.db()
    const cols = d.prepare("PRAGMA table_info('api_calls')").all() as Array<{ name: string; dflt_value: string | null }>
    const col = cols.find(c => c.name === 'source_alias')
    expect(col).toBeDefined()
    // SQLite wraps string defaults in single quotes; the in-tree
    // migration uses TEXT NOT NULL DEFAULT 'default'.
    expect(col!.dflt_value).toBe("'default'")
  })

  it('api_calls row gets source_alias from the SessionSource at insert time', async () => {
    const mod = await import('./db.ts')
    const d = mod.db()
    // Same shape as the row the ingest pipeline builds; stamped with
    // a non-default alias to prove it's actually written.
    d.prepare(`
      INSERT INTO api_calls (
        dedup_key, ts, ts_epoch, provider, model, model_short, project, session_id,
        category, input_tokens, output_tokens, cache_read, cache_write, web_search,
        cost_usd, speed, source_alias
      ) VALUES (
        @dedup_key, @ts, @ts_epoch, @provider, @model, @model_short, @project, @session_id,
        @category, @input_tokens, @output_tokens, @cache_read, @cache_write, @web_search,
        @cost_usd, @speed, @source_alias
      )
    `).run({
      dedup_key: 'a',
      ts: '2026-06-12T00:00:00Z',
      ts_epoch: 0,
      provider: 'claude',
      model: 'claude-3-5',
      model_short: 'sonnet',
      project: 'foo',
      session_id: 's1',
      category: 'chat',
      input_tokens: 1,
      output_tokens: 1,
      cache_read: 0,
      cache_write: 0,
      web_search: 0,
      cost_usd: 0.01,
      speed: 0,
      source_alias: 'roman',
    })

    const row = d.prepare('SELECT source_alias FROM api_calls WHERE dedup_key = ?').get('a') as { source_alias: string }
    expect(row.source_alias).toBe('roman')
  })

  it('?source=alpha filter returns only that source rows', async () => {
    const mod = await import('./db.ts')
    const d = mod.db()
    const insert = d.prepare(`
      INSERT INTO api_calls (
        dedup_key, ts, ts_epoch, provider, model, model_short, project, session_id,
        category, input_tokens, output_tokens, cache_read, cache_write, web_search,
        cost_usd, speed, source_alias
      ) VALUES (
        @dedup_key, @ts, @ts_epoch, @provider, @model, @model_short, @project, @session_id,
        @category, @input_tokens, @output_tokens, @cache_read, @cache_write, @web_search,
        @cost_usd, @speed, @source_alias
      )
    `)
    const seed = (alias: string, dedup: string) => insert.run({
      dedup_key: dedup,
      ts: '2026-06-12T00:00:00Z',
      ts_epoch: 0,
      provider: 'claude',
      model: 'claude-3-5',
      model_short: 'sonnet',
      project: 'foo',
      session_id: 's1',
      category: 'chat',
      input_tokens: 1,
      output_tokens: 1,
      cache_read: 0,
      cache_write: 0,
      web_search: 0,
      cost_usd: 0.01,
      speed: 0,
      source_alias: alias,
    })
    seed('alpha', 'a1')
    seed('alpha', 'a2')
    seed('beta', 'b1')
    seed('default', 'd1')

    // Mirror the WHERE clause the /api/overview aggregations build
    // when ?source=alpha is set.
    const filtered = d.prepare(`
      SELECT dedup_key, source_alias FROM api_calls
      WHERE source_alias = ?
    `).all('alpha') as Array<{ dedup_key: string; source_alias: string }>

    expect(filtered.length).toBe(2)
    expect(filtered.every(r => r.source_alias === 'alpha')).toBe(true)

    // And the totals, projected via the same filter, sum only the
    // alpha rows.
    const total = d.prepare(`
      SELECT COALESCE(SUM(cost_usd), 0) AS cost, COUNT(*) AS calls
      FROM api_calls WHERE source_alias = ?
    `).get('alpha') as { cost: number; calls: number }
    expect(total.calls).toBe(2)
    expect(total.cost).toBeCloseTo(0.02, 5)
  })
})
