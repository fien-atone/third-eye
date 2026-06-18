/**
 * Hermes Agent provider — reads session telemetry from ~/.hermes/state.db.
 *
 * Hermes is an open-source Python agent wrapper (NousResearch/hermes-agent)
 * that can proxy multiple AI backends including GPT models via Codex
 * subscription (chatgpt.com/backend-api/codex).
 *
 * Data shape:
 *   - One `sessions` row per conversation thread (already aggregated).
 *   - Per-message token breakdown is not stored (messages.token_count = NULL),
 *     so we map one Hermes session → one api_calls row. This is the maximum
 *     granularity the data allows.
 *   - Cost: Hermes marks Codex sessions as billing_mode='subscription_included'
 *     and estimated_cost_usd=0. We calculate theoretical cost via the shared
 *     pricing system for consistency with Codex provider behaviour; the number
 *     reflects what the tokens would cost at list price, not actual charges.
 *   - Project: Hermes has no cwd concept. All sessions land in a synthetic
 *     "hermes" project key.
 */

import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

import { calculateCost, getShortModelName } from '../models.js'
import type { Provider, SessionSource, SessionParser, ParsedProviderCall } from './types.js'

// ──────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────

const HERMES_PROJECT = 'hermes'

// Tool names Hermes uses internally → canonical third-eye display names.
// Hermes stores tool_call_count but not individual tool names at session
// level, so toolDisplayName is used only for future per-turn parsing.
const TOOL_NAME_MAP: Record<string, string> = {
  exec_command:    'Bash',
  bash:            'Bash',
  read_file:       'Read',
  write_file:      'Edit',
  apply_diff:      'Edit',
  browser_navigate: 'Browser',
  browser_back:    'Browser',
  web_search:      'WebSearch',
  spawn_agent:     'Agent',
}

// ──────────────────────────────────────────────────────────────────────
// DB access — read-only, no connection caching (each ingest opens fresh)
// ──────────────────────────────────────────────────────────────────────

type HermesSessionRow = {
  id: string
  model: string | null
  source: string | null
  started_at: number
  ended_at: number | null
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  api_call_count: number
  tool_call_count: number
  billing_mode: string | null
  billing_base_url: string | null
  title: string | null
}

function getHermesDbPath(hermesHome?: string): string {
  const base = hermesHome
    ?? process.env['HERMES_HOME']
    ?? join(homedir(), '.hermes')
  return join(base, 'state.db')
}

function openDb(dbPath: string): Database.Database | null {
  if (!existsSync(dbPath)) return null
  try {
    return new Database(dbPath, { readonly: true, fileMustExist: true })
  } catch {
    return null
  }
}

function querySessions(db: Database.Database): HermesSessionRow[] {
  return db.prepare(`
    SELECT id, model, source, started_at, ended_at,
           input_tokens, output_tokens, cache_read_tokens,
           cache_write_tokens, reasoning_tokens,
           api_call_count, tool_call_count,
           billing_mode, billing_base_url, title
    FROM sessions
    WHERE input_tokens > 0 OR output_tokens > 0
    ORDER BY started_at ASC
  `).all() as HermesSessionRow[]
}

// ──────────────────────────────────────────────────────────────────────
// Conversion: one Hermes session row → one ParsedProviderCall
// ──────────────────────────────────────────────────────────────────────

function sessionToCall(row: HermesSessionRow, seenKeys: Set<string>): ParsedProviderCall | null {
  const dedupKey = `hermes:${row.id}`
  if (seenKeys.has(dedupKey)) return null
  seenKeys.add(dedupKey)

  const model = row.model ?? 'gpt-5.5'
  const timestamp = new Date(row.started_at * 1000).toISOString()

  // Hermes caches are written by the backend and read on subsequent turns —
  // same semantics as Claude's cache_creation / cache_read.
  const cost = calculateCost(
    model,
    row.input_tokens,
    row.output_tokens + row.reasoning_tokens,
    row.cache_write_tokens,
    row.cache_read_tokens,
    0,
    'standard',
  )

  return {
    provider: 'hermes',
    model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheCreationInputTokens: row.cache_write_tokens,
    cacheReadInputTokens: row.cache_read_tokens,
    cachedInputTokens: row.cache_read_tokens,
    reasoningTokens: row.reasoning_tokens,
    webSearchRequests: 0,
    costUSD: cost,
    tools: [],
    timestamp,
    speed: 'standard',
    deduplicationKey: dedupKey,
    userMessage: row.title ?? '',
    sessionId: row.id,
  }
}

// ──────────────────────────────────────────────────────────────────────
// Provider factory
// ──────────────────────────────────────────────────────────────────────

export function createHermesProvider(hermesHome?: string): Provider {
  const dbPath = getHermesDbPath(hermesHome)

  return {
    name: 'hermes',
    displayName: 'Hermes',

    modelDisplayName(model: string): string {
      return getShortModelName(model)
    },

    toolDisplayName(rawTool: string): string {
      return TOOL_NAME_MAP[rawTool] ?? rawTool
    },

    async discoverSessions(): Promise<SessionSource[]> {
      const db = openDb(dbPath)
      if (!db) return []
      try {
        const rows = querySessions(db)
        return rows.map(r => ({
          path: r.id,
          project: HERMES_PROJECT,
          provider: 'hermes',
          // Hermes Agent has a single source — its own state.db. We
          // stamp every row with the 'hermes' alias so the dashboard's
          // ?source=hermes filter can isolate it from claude/codex.
          sourceAlias: 'hermes',
        }))
      } finally {
        db.close()
      }
    },

    createSessionParser(source: SessionSource, seenKeys: Set<string>): SessionParser {
      return {
        async *parse(): AsyncGenerator<ParsedProviderCall> {
          const db = openDb(dbPath)
          if (!db) return
          try {
            const row = db.prepare(`
              SELECT id, model, source, started_at, ended_at,
                     input_tokens, output_tokens, cache_read_tokens,
                     cache_write_tokens, reasoning_tokens,
                     api_call_count, tool_call_count,
                     billing_mode, billing_base_url, title
              FROM sessions WHERE id = ?
            `).get(source.path) as HermesSessionRow | undefined
            if (!row) return
            const call = sessionToCall(row, seenKeys)
            if (call) yield call
          } finally {
            db.close()
          }
        },
      }
    },
  }
}

export const hermes = createHermesProvider()
