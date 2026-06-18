import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { claude } from './claude.ts'

/** Tests for the multi-source Claude provider — the discoverSessions()
 *  loop now walks every configured Claude root and stamps each
 *  SessionSource with the source's alias, so the dashboard can filter
 *  by `?source=<alias>`. Two key properties:
 *
 *    1. Each SessionSource's sourceAlias matches the Claude source
 *       the session was discovered under.
 *    2. Sources do NOT collapse projects with the same name across
 *       different roots — `~/.claude-invent/projects/foo` and
 *       `~/.claude-roman/projects/foo` are kept as distinct rows,
 *       with different sourceAlias values, so the per-source cost
 *       breakdown stays accurate.
 *
 *  We avoid hitting the desktop-side walk in these tests by pointing
 *  THIRD_EYE_CLAUDE_DIRS at temp dirs that don't contain a
 *  Claude/desktop layout — findDesktopProjectDirs() walks the
 *  claudeDesktopSessionsDir() and will simply find nothing.
 */
describe('claude.discoverSessions — multi-source', () => {
  let prevTEDirs: string | undefined
  let prevTEAliases: string | undefined
  let prevTE: string | undefined
  let prevCC: string | undefined
  let tmpRoot: string
  let srcA: string
  let srcB: string

  beforeEach(() => {
    prevTEDirs = process.env.THIRD_EYE_CLAUDE_DIRS
    prevTEAliases = process.env.THIRD_EYE_CLAUDE_DIR_ALIASES
    prevTE = process.env.THIRD_EYE_CLAUDE_DIR
    prevCC = process.env.CLAUDE_CONFIG_DIR
    delete process.env.THIRD_EYE_CLAUDE_DIR
    delete process.env.CLAUDE_CONFIG_DIR
    delete process.env.THIRD_EYE_CLAUDE_DIRS
    delete process.env.THIRD_EYE_CLAUDE_DIR_ALIASES

    // Two parallel Claude roots, each with one project named "foo".
    // The whole point of multi-source is to NOT collapse them.
    tmpRoot = mkdtempSync(join(tmpdir(), 'third-eye-claude-test-'))
    srcA = join(tmpRoot, 'claude-invent')
    srcB = join(tmpRoot, 'claude-roman')
    mkdirSync(join(srcA, 'projects', 'foo'), { recursive: true })
    mkdirSync(join(srcB, 'projects', 'foo'), { recursive: true })
  })

  afterEach(() => {
    if (prevTEDirs === undefined) delete process.env.THIRD_EYE_CLAUDE_DIRS
    else process.env.THIRD_EYE_CLAUDE_DIRS = prevTEDirs
    if (prevTEAliases === undefined) delete process.env.THIRD_EYE_CLAUDE_DIR_ALIASES
    else process.env.THIRD_EYE_CLAUDE_DIR_ALIASES = prevTEAliases
    if (prevTE === undefined) delete process.env.THIRD_EYE_CLAUDE_DIR
    else process.env.THIRD_EYE_CLAUDE_DIR = prevTE
    if (prevCC === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevCC
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('stamps every SessionSource with its source alias', async () => {
    process.env.THIRD_EYE_CLAUDE_DIRS = `${srcA},${srcB}`
    process.env.THIRD_EYE_CLAUDE_DIR_ALIASES = 'invent,roman'

    const sources = await claude.discoverSessions()
    // Filter out any desktop-side rows the walk may have surfaced —
    // we only assert on the claude-root-discovered rows here.
    const fromRoots = sources.filter(s => s.provider === 'claude' && s.sourceAlias !== 'desktop')
    expect(fromRoots.length).toBeGreaterThanOrEqual(2)

    // Every row we got from the configured roots must carry the
    // sourceAlias of the root it came from. (No 'default' sneaking
    // through.)
    for (const s of fromRoots) {
      expect(['invent', 'roman']).toContain(s.sourceAlias)
      expect(s.provider).toBe('claude')
    }

    // And at least one row per source. With our fixture each source
    // has exactly one project ('foo'), so 1+1 = 2.
    const aliases = new Set(fromRoots.map(s => s.sourceAlias))
    expect(aliases.has('invent')).toBe(true)
    expect(aliases.has('roman')).toBe(true)
  })

  it('keeps projects with the same name distinct across sources', async () => {
    process.env.THIRD_EYE_CLAUDE_DIRS = `${srcA},${srcB}`
    process.env.THIRD_EYE_CLAUDE_DIR_ALIASES = 'invent,roman'

    const sources = await claude.discoverSessions()
    const fromRoots = sources.filter(s => s.provider === 'claude' && s.sourceAlias !== 'desktop')
    // Both 'foo' rows must exist (one per source) — the multi-source
    // path does NOT collapse them. Pre-multi-source this would have
    // been a single row keyed on `project` and we'd have lost
    // per-source attribution.
    const fooRows = fromRoots.filter(s => s.project === 'foo')
    expect(fooRows.length).toBe(2)
    expect(new Set(fooRows.map(s => s.sourceAlias))).toEqual(new Set(['invent', 'roman']))

    // Sanity: the path of each row points at the right source root.
    const inventFoo = fooRows.find(s => s.sourceAlias === 'invent')!
    const romanFoo = fooRows.find(s => s.sourceAlias === 'roman')!
    expect(inventFoo.path.startsWith(srcA)).toBe(true)
    expect(romanFoo.path.startsWith(srcB)).toBe(true)
  })
})
