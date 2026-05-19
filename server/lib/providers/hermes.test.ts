import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHermesProvider } from './hermes.ts'

// ──────────────────────────────────────────────────────────────────────
// Fixture helpers
// ──────────────────────────────────────────────────────────────────────

function createFixtureDb(dir: string): string {
  const dbPath = join(dir, 'state.db')
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      model TEXT,
      source TEXT,
      started_at REAL NOT NULL,
      ended_at REAL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      reasoning_tokens INTEGER DEFAULT 0,
      api_call_count INTEGER DEFAULT 0,
      tool_call_count INTEGER DEFAULT 0,
      billing_mode TEXT,
      billing_base_url TEXT,
      title TEXT
    )
  `)

  db.prepare(`
    INSERT INTO sessions VALUES
      ('sess_aaa', 'gpt-5.5', 'cli', 1716000000.0, 1716000060.0,
       10000, 2000, 50000, 0, 100, 5, 3,
       'subscription_included', 'https://chatgpt.com/backend-api/codex',
       'First conversation'),
      ('sess_bbb', 'gpt-5.5', 'cli', 1716001000.0, 1716001120.0,
       20000, 4000, 100000, 0, 200, 8, 5,
       'subscription_included', 'https://chatgpt.com/backend-api/codex',
       'Second conversation'),
      ('sess_zero', 'gpt-5.5', 'cli', 1716002000.0, null,
       0, 0, 0, 0, 0, 0, 0,
       null, null, 'Empty session — should be excluded')
  `).run()

  db.close()
  return dbPath
}

// ──────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hermes-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('createHermesProvider — no DB', () => {
  it('discoverSessions returns [] when state.db does not exist', async () => {
    const provider = createHermesProvider(join(tmpDir, 'nonexistent'))
    const sessions = await provider.discoverSessions()
    expect(sessions).toEqual([])
  })

  it('parser yields nothing when state.db is missing', async () => {
    const provider = createHermesProvider(join(tmpDir, 'nonexistent'))
    const parser = provider.createSessionParser(
      { path: 'sess_aaa', project: 'hermes', provider: 'hermes' },
      new Set(),
    )
    const calls: unknown[] = []
    for await (const c of parser.parse()) calls.push(c)
    expect(calls).toHaveLength(0)
  })
})

describe('createHermesProvider — with fixture DB', () => {
  it('discoverSessions returns one source per session with tokens', async () => {
    createFixtureDb(tmpDir)
    const provider = createHermesProvider(tmpDir)
    const sessions = await provider.discoverSessions()

    // sess_zero has 0 tokens → excluded by WHERE clause
    expect(sessions).toHaveLength(2)
    expect(sessions.every(s => s.project === 'hermes')).toBe(true)
    expect(sessions.every(s => s.provider === 'hermes')).toBe(true)
    expect(sessions.map(s => s.path)).toContain('sess_aaa')
    expect(sessions.map(s => s.path)).toContain('sess_bbb')
  })

  it('parser yields one ParsedProviderCall with correct token fields', async () => {
    createFixtureDb(tmpDir)
    const provider = createHermesProvider(tmpDir)
    const parser = provider.createSessionParser(
      { path: 'sess_aaa', project: 'hermes', provider: 'hermes' },
      new Set(),
    )
    const calls: Awaited<ReturnType<typeof parser.parse extends () => AsyncGenerator<infer T> ? () => AsyncGenerator<T> : never>>[] = []
    for await (const c of parser.parse()) calls.push(c as never)

    expect(calls).toHaveLength(1)
    const c = calls[0] as import('./types.ts').ParsedProviderCall
    expect(c.provider).toBe('hermes')
    expect(c.model).toBe('gpt-5.5')
    expect(c.inputTokens).toBe(10000)
    expect(c.outputTokens).toBe(2000)
    expect(c.cacheReadInputTokens).toBe(50000)
    expect(c.reasoningTokens).toBe(100)
    expect(c.sessionId).toBe('sess_aaa')
    expect(c.deduplicationKey).toBe('hermes:sess_aaa')
    expect(c.userMessage).toBe('First conversation')
    expect(c.costUSD).toBeGreaterThan(0)
  })

  it('deduplication key prevents double-counting', async () => {
    createFixtureDb(tmpDir)
    const provider = createHermesProvider(tmpDir)
    const seenKeys = new Set<string>()
    seenKeys.add('hermes:sess_aaa') // pre-mark as seen

    const parser = provider.createSessionParser(
      { path: 'sess_aaa', project: 'hermes', provider: 'hermes' },
      seenKeys,
    )
    const calls: unknown[] = []
    for await (const c of parser.parse()) calls.push(c)
    expect(calls).toHaveLength(0)
  })

  it('parser for unknown session_id yields nothing', async () => {
    createFixtureDb(tmpDir)
    const provider = createHermesProvider(tmpDir)
    const parser = provider.createSessionParser(
      { path: 'sess_nonexistent', project: 'hermes', provider: 'hermes' },
      new Set(),
    )
    const calls: unknown[] = []
    for await (const c of parser.parse()) calls.push(c)
    expect(calls).toHaveLength(0)
  })

  it('modelDisplayName delegates to getShortModelName', () => {
    createFixtureDb(tmpDir)
    const provider = createHermesProvider(tmpDir)
    expect(provider.modelDisplayName('gpt-5.5')).toBe('GPT-5.5')
    expect(provider.modelDisplayName('gpt-5.4-mini')).toBe('GPT-5.4 Mini')
  })

  it('cost is non-zero for real token counts', async () => {
    createFixtureDb(tmpDir)
    const provider = createHermesProvider(tmpDir)
    const parser = provider.createSessionParser(
      { path: 'sess_bbb', project: 'hermes', provider: 'hermes' },
      new Set(),
    )
    for await (const c of parser.parse()) {
      expect(c.costUSD).toBeGreaterThan(0)
    }
  })
})
