import { describe, it, expect } from 'vitest'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { readFile } from 'fs/promises'
import { detectRole, parseAgentFile } from './agent-sessions.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(__dirname, '..', '__fixtures__', 'agent-jsonl')

/** Read a fixture's meta.json the same way the production crawler
 *  does — try/parse, return null if absent or malformed. Mirrors the
 *  defensive behavior we want from the real crawler too. */
async function readMeta(stem: string): Promise<{ description: string | null; agentType: string | null }> {
  try {
    const raw = await readFile(join(FIXTURES, `${stem}.meta.json`), 'utf-8')
    const parsed = JSON.parse(raw) as { description?: string; agentType?: string }
    return {
      description: typeof parsed.description === 'string' ? parsed.description : null,
      agentType: typeof parsed.agentType === 'string' ? parsed.agentType : null,
    }
  } catch {
    return { description: null, agentType: null }
  }
}

describe('detectRole — pure function, three confidence tiers', () => {
  it('uses meta.agentType first when present', () => {
    expect(detectRole('frontend-dev', 'anything', 'You are the architect')).toEqual({
      role: 'frontend-dev', confidence: 'meta',
    })
  })

  it('lowercases agentType', () => {
    expect(detectRole('FRONTEND-DEV', null, null).role).toBe('frontend-dev')
  })

  it('falls through to description "<role>:" prefix when no agentType', () => {
    expect(detectRole(null, 'backend-dev: investigate slow query', null)).toEqual({
      role: 'backend-dev', confidence: 'meta',
    })
  })

  it('falls through to "You are the X" regex when no meta signals', () => {
    expect(detectRole(null, null, 'You are the qa engineer.')).toEqual({
      role: 'qa', confidence: 'prompt',
    })
  })

  it('returns unknown when nothing matches', () => {
    expect(detectRole(null, null, 'npc_id: outsider_branimir tick: 19')).toEqual({
      role: 'unknown', confidence: 'unknown',
    })
  })

  it('treats empty agentType as no signal', () => {
    expect(detectRole('   ', null, 'You are the architect')).toEqual({
      role: 'architect', confidence: 'prompt',
    })
  })
})

describe('parseAgentFile — JSONL → row, integration with fixtures', () => {
  it('extracts role from meta.agentType (modern Claude Code)', async () => {
    const meta = await readMeta('with-agent-type')
    const row = await parseAgentFile(
      join(FIXTURES, 'with-agent-type.jsonl'),
      { source: 'subagent', project: 'test-proj', metaDesc: meta.description, metaAgentType: meta.agentType }
    )
    expect(row).not.toBeNull()
    expect(row!.role).toBe('frontend-dev')
    expect(row!.role_confidence).toBe('meta')
    expect(row!.description).toBe('Refactor login form')
    expect(row!.prompt_id).toBe('a1111111-1111-1111-1111-111111111111')
    // Two assistant turns; last stop_reason wins
    expect(row!.stop_reason).toBe('end_turn')
    // Token math from fixture: 100+50 input, 50 cache_create,
    // 1000+1500 cache_read, 40+80 output = sums independently.
    expect(row!.input_tokens).toBe(150)
    expect(row!.cache_create_tokens).toBe(50)
    expect(row!.cache_read_tokens).toBe(2500)
    expect(row!.output_tokens).toBe(120)
    expect(row!.total_tokens).toBe(2820)
    expect(row!.api_calls).toBe(2)
    // tool_uses comes from assistant content blocks of type 'tool_use'
    expect(row!.tool_uses).toBe(1)
    expect(row!.tools_json).toBe('{"Read":1}')
  })

  it('falls back to description "<role>:" prefix when no agentType', async () => {
    const meta = await readMeta('with-description-prefix')
    const row = await parseAgentFile(
      join(FIXTURES, 'with-description-prefix.jsonl'),
      { source: 'subagent', project: 'test-proj', metaDesc: meta.description, metaAgentType: meta.agentType }
    )
    expect(row).not.toBeNull()
    expect(row!.role).toBe('backend-dev')
    expect(row!.role_confidence).toBe('meta')
  })

  it('falls back to "You are the X" prompt regex when no meta', async () => {
    const row = await parseAgentFile(
      join(FIXTURES, 'you-are-the-x.jsonl'),
      { source: 'subagent', project: 'test-proj', metaDesc: null, metaAgentType: null }
    )
    expect(row).not.toBeNull()
    expect(row!.role).toBe('qa')
    expect(row!.role_confidence).toBe('prompt')
  })

  it('returns role=unknown when nothing classifies', async () => {
    const row = await parseAgentFile(
      join(FIXTURES, 'no-role-signal.jsonl'),
      { source: 'subagent', project: 'test-proj', metaDesc: null, metaAgentType: null }
    )
    expect(row).not.toBeNull()
    expect(row!.role).toBe('unknown')
    expect(row!.role_confidence).toBe('unknown')
    // Description fallback: cleaned first user message slice
    expect(row!.description).toContain('outsider_branimir')
  })

  it('survives a corrupt meta.json (parser must not crash)', async () => {
    const meta = await readMeta('corrupt-meta')
    // Both fields end up null because JSON.parse threw.
    expect(meta.description).toBe(null)
    expect(meta.agentType).toBe(null)

    const row = await parseAgentFile(
      join(FIXTURES, 'corrupt-meta.jsonl'),
      { source: 'subagent', project: 'test-proj', metaDesc: meta.description, metaAgentType: meta.agentType }
    )
    expect(row).not.toBeNull()
    // Falls through to "You are the architect" prompt regex
    expect(row!.role).toBe('architect')
    expect(row!.role_confidence).toBe('prompt')
  })

  it('returns null for a transcript with no billable tokens (validity gate)', async () => {
    const row = await parseAgentFile(
      join(FIXTURES, 'empty-tokens.jsonl'),
      { source: 'subagent', project: 'test-proj', metaDesc: null, metaAgentType: null }
    )
    expect(row).toBeNull()
  })

  it('returns null when the file is unreadable', async () => {
    const row = await parseAgentFile(
      join(FIXTURES, 'this-file-does-not-exist.jsonl'),
      { source: 'subagent', project: 'test-proj', metaDesc: null, metaAgentType: null }
    )
    expect(row).toBeNull()
  })
})
