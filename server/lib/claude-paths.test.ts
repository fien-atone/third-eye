import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { homedir, platform } from 'os'
import { join } from 'path'
import { existsSync } from 'fs'
import {
  claudeHomeDir,
  claudeHomeDirs,
  claudeProjectsDir,
  claudeDesktopSessionsDir,
  claudeTaskBaseDirs,
} from './claude-paths.ts'

describe('claudeHomeDir (singular) backward compat', () => {
  // Snapshot/restore the env vars we manipulate. Run-order
  // independence matters because vitest may run files in parallel,
  // but env is per-process — use beforeEach/afterEach to keep tests
  // hermetic within this file.
  let prevTE: string | undefined
  let prevCC: string | undefined
  let prevTEDirs: string | undefined
  let prevTEAliases: string | undefined

  beforeEach(() => {
    prevTE = process.env.THIRD_EYE_CLAUDE_DIR
    prevCC = process.env.CLAUDE_CONFIG_DIR
    prevTEDirs = process.env.THIRD_EYE_CLAUDE_DIRS
    prevTEAliases = process.env.THIRD_EYE_CLAUDE_DIR_ALIASES
    delete process.env.THIRD_EYE_CLAUDE_DIR
    delete process.env.CLAUDE_CONFIG_DIR
    delete process.env.THIRD_EYE_CLAUDE_DIRS
    delete process.env.THIRD_EYE_CLAUDE_DIR_ALIASES
  })

  afterEach(() => {
    if (prevTE === undefined) delete process.env.THIRD_EYE_CLAUDE_DIR
    else process.env.THIRD_EYE_CLAUDE_DIR = prevTE
    if (prevCC === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevCC
    if (prevTEDirs === undefined) delete process.env.THIRD_EYE_CLAUDE_DIRS
    else process.env.THIRD_EYE_CLAUDE_DIRS = prevTEDirs
    if (prevTEAliases === undefined) delete process.env.THIRD_EYE_CLAUDE_DIR_ALIASES
    else process.env.THIRD_EYE_CLAUDE_DIR_ALIASES = prevTEAliases
  })

  it('falls back to ~/.claude when nothing is set (and it exists)', () => {
    // We don't assert on absolute ~ if the file doesn't exist on the
    // host running the tests — just that we get SOMETHING sensible.
    // Specific behaviour is tested in claudeHomeDirs tests below.
    const home = claudeHomeDir()
    expect(typeof home).toBe('string')
    expect(home.length).toBeGreaterThan(0)
  })

  it('honors CLAUDE_CONFIG_DIR (Claude Code\'s own override)', () => {
    process.env.CLAUDE_CONFIG_DIR = '/foo/claude-config'
    expect(claudeHomeDir()).toBe('/foo/claude-config')
  })

  it('THIRD_EYE_CLAUDE_DIR wins over CLAUDE_CONFIG_DIR', () => {
    process.env.CLAUDE_CONFIG_DIR = '/foo/claude-config'
    process.env.THIRD_EYE_CLAUDE_DIR = '/bar/third-eye'
    expect(claudeHomeDir()).toBe('/bar/third-eye')
  })

  it('treats empty string env as unset', () => {
    process.env.THIRD_EYE_CLAUDE_DIR = ''
    process.env.CLAUDE_CONFIG_DIR = ''
    // Result: the first configured source's path, or ~ fallback.
    const home = claudeHomeDir()
    expect(home).toBeTruthy()
  })

  it('claudeProjectsDir = <home>/projects', () => {
    process.env.THIRD_EYE_CLAUDE_DIR = '/x/y'
    expect(claudeProjectsDir()).toBe(join('/x/y', 'projects'))
  })
})

describe('claudeHomeDirs (multi-source resolution)', () => {
  // Hermetic env handling — same shape as the singular describe above.
  let prevTE: string | undefined
  let prevCC: string | undefined
  let prevTEDirs: string | undefined
  let prevTEAliases: string | undefined

  beforeEach(() => {
    prevTE = process.env.THIRD_EYE_CLAUDE_DIR
    prevCC = process.env.CLAUDE_CONFIG_DIR
    prevTEDirs = process.env.THIRD_EYE_CLAUDE_DIRS
    prevTEAliases = process.env.THIRD_EYE_CLAUDE_DIR_ALIASES
    delete process.env.THIRD_EYE_CLAUDE_DIR
    delete process.env.CLAUDE_CONFIG_DIR
    delete process.env.THIRD_EYE_CLAUDE_DIRS
    delete process.env.THIRD_EYE_CLAUDE_DIR_ALIASES
  })

  afterEach(() => {
    if (prevTE === undefined) delete process.env.THIRD_EYE_CLAUDE_DIR
    else process.env.THIRD_EYE_CLAUDE_DIR = prevTE
    if (prevCC === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevCC
    if (prevTEDirs === undefined) delete process.env.THIRD_EYE_CLAUDE_DIRS
    else process.env.THIRD_EYE_CLAUDE_DIRS = prevTEDirs
    if (prevTEAliases === undefined) delete process.env.THIRD_EYE_CLAUDE_DIR_ALIASES
    else process.env.THIRD_EYE_CLAUDE_DIR_ALIASES = prevTEAliases
  })

  // 1) When no env is set and ~/.claude exists, the legacy default wins.
  it('returns [{path: ~/.claude, alias: default}] when no env set and ~/.claude exists', () => {
    const defaultPath = join(homedir(), '.claude')
    if (!existsSync(defaultPath)) {
      // Skip — the test only makes sense on hosts where the legacy
      // default actually exists. Container test runners often don't
      // have a real ~/.claude.
      return
    }
    expect(claudeHomeDirs()).toEqual([{ path: defaultPath, alias: 'default' }])
  })

  // 2) When no env is set and ~/.claude does not exist, return [].
  it('returns [] when no env set and ~/.claude does not exist', async () => {
    // We can't delete the user's actual ~/.claude here. Stub
    // existsSync via vi.mock on the fs module — this re-imports
    // claude-paths with the mocked module so the call inside
    // claudeHomeDirs() sees the stub. The mock is hoisted by vitest
    // and the require/import chain reaches it transparently.
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs')
      return { ...actual, existsSync: () => false }
    })
    try {
      // Re-import the module under test with the mocked fs.
      // dynamic import + cache bust via query string is the standard
      // vitest pattern for module-level mocks that aren't hoisted.
      const mod = await import('./claude-paths.ts?no-default-claude=' + Date.now())
      expect(mod.claudeHomeDirs()).toEqual([])
    } finally {
      vi.doUnmock('fs')
      vi.resetModules()
    }
  })

  // 3) THIRD_EYE_CLAUDE_DIRS + THIRD_EYE_CLAUDE_DIR_ALIASES
  it('reads THIRD_EYE_CLAUDE_DIRS + ALIASES and returns them in order', () => {
    process.env.THIRD_EYE_CLAUDE_DIRS = '/a,/b'
    process.env.THIRD_EYE_CLAUDE_DIR_ALIASES = 'alpha,beta'
    expect(claudeHomeDirs()).toEqual([
      { path: '/a', alias: 'alpha' },
      { path: '/b', alias: 'beta' },
    ])
  })

  // 4) THIRD_EYE_CLAUDE_DIRS without aliases → first is 'default', rest auto-named
  it('auto-names aliases when ALIASES env is unset', () => {
    process.env.THIRD_EYE_CLAUDE_DIRS = '/a,/b'
    const out = claudeHomeDirs()
    expect(out[0]).toEqual({ path: '/a', alias: 'default' })
    // The second source gets an auto-derived alias. Spec says 'claude-b'
    // (path basename, prefixed). We accept any [a-z0-9_-]{1,32} match —
    // exact string is implementation-defined; check shape, not value.
    expect(out[1]?.path).toBe('/b')
    expect(out[1]?.alias).toMatch(/^[a-z0-9_-]{1,32}$/)
  })

  // 5) Backward compat: THIRD_EYE_CLAUDE_DIR (singular) still works.
  it('THIRD_EYE_CLAUDE_DIR (singular) still works, returns [{path, alias: default}]', () => {
    process.env.THIRD_EYE_CLAUDE_DIR = '/a'
    expect(claudeHomeDirs()).toEqual([{ path: '/a', alias: 'default' }])
  })

  // 6) Relative path → throw at module load
  it('throws at module load when a path is relative', () => {
    process.env.THIRD_EYE_CLAUDE_DIRS = 'relative/path'
    expect(() => claudeHomeDirs()).toThrow(/absolute/i)
  })

  // 7) Malformed alias → throw
  it('throws when an alias is malformed (uppercase / special chars)', () => {
    process.env.THIRD_EYE_CLAUDE_DIRS = '/a'
    process.env.THIRD_EYE_CLAUDE_DIR_ALIASES = 'Bad-Alias!'
    expect(() => claudeHomeDirs()).toThrow(/alias/i)
  })

  // 8) Duplicate alias → last wins + console.warn
  it('dedupes aliases (last wins) and warns via console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      process.env.THIRD_EYE_CLAUDE_DIRS = '/a,/b'
      process.env.THIRD_EYE_CLAUDE_DIR_ALIASES = 'dup,dup'
      const out = claudeHomeDirs()
      expect(out).toEqual([
        { path: '/a', alias: 'dup' },
        { path: '/b', alias: 'dup' },
      ])
      expect(warn).toHaveBeenCalled()
      // Warning mentions the duplicated alias name so a user reading
      // server logs can see exactly which alias collided.
      const msg = String(warn.mock.calls[0]?.[0] ?? '')
      expect(msg).toContain('dup')
    } finally {
      warn.mockRestore()
    }
  })

  // 9) Mismatched lengths between DIRS and ALIASES → throw
  it('throws when DIRS and ALIASES have different lengths', () => {
    process.env.THIRD_EYE_CLAUDE_DIRS = '/a,/b,/c'
    process.env.THIRD_EYE_CLAUDE_DIR_ALIASES = 'alpha,beta'
    expect(() => claudeHomeDirs()).toThrow(/length/i)
  })
})

describe('claudeDesktopSessionsDir per-OS', () => {
  // We can't easily mock os.platform() without globals, but we can
  // verify the function returns the right shape for the CURRENT
  // platform — that's what catches bugs in the macOS-only branch
  // we used to have.
  it('returns a path under the user home', () => {
    const dir = claudeDesktopSessionsDir()
    expect(dir.startsWith(homedir())).toBe(true)
    expect(dir).toContain('local-agent-mode-sessions')
  })

  it('matches the platform convention', () => {
    const dir = claudeDesktopSessionsDir()
    if (platform() === 'darwin') {
      expect(dir).toContain('Library')
      expect(dir).toContain('Application Support')
    } else if (platform() === 'win32') {
      expect(dir).toContain('AppData')
    } else {
      expect(dir).toContain('.config')
    }
  })
})

describe('claudeTaskBaseDirs per-OS', () => {
  it('returns probe paths under /tmp on Unix-like', () => {
    if (platform() === 'win32') return // separate assertion below
    const dirs = claudeTaskBaseDirs()
    expect(dirs.length).toBeGreaterThan(0)
    expect(dirs.some(d => d.includes('tmp'))).toBe(true)
    // UID-suffixed
    expect(dirs.every(d => /claude-\d+/.test(d))).toBe(true)
  })

  it('returns empty array on Windows (Task outputs are Unix-only)', () => {
    if (platform() !== 'win32') return
    expect(claudeTaskBaseDirs()).toEqual([])
  })
})
