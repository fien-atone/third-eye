import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { homedir, platform } from 'os'
import { join } from 'path'
import {
  claudeHomeDir,
  claudeProjectsDir,
  claudeDesktopSessionsDir,
  claudeTaskBaseDirs,
} from './claude-paths.ts'

describe('claudeHomeDir env priority', () => {
  // Snapshot/restore the two env vars we manipulate. Run order
  // independence matters because vitest may run files in parallel
  // or different threads, but env is per-process — use beforeEach/
  // afterEach to keep tests hermetic within this file.
  let prevTE: string | undefined
  let prevCC: string | undefined

  beforeEach(() => {
    prevTE = process.env.THIRD_EYE_CLAUDE_DIR
    prevCC = process.env.CLAUDE_CONFIG_DIR
    delete process.env.THIRD_EYE_CLAUDE_DIR
    delete process.env.CLAUDE_CONFIG_DIR
  })

  afterEach(() => {
    if (prevTE === undefined) delete process.env.THIRD_EYE_CLAUDE_DIR
    else process.env.THIRD_EYE_CLAUDE_DIR = prevTE
    if (prevCC === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevCC
  })

  it('falls back to ~/.claude when nothing is set', () => {
    expect(claudeHomeDir()).toBe(join(homedir(), '.claude'))
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
    expect(claudeHomeDir()).toBe(join(homedir(), '.claude'))
  })

  it('claudeProjectsDir = <home>/projects', () => {
    process.env.THIRD_EYE_CLAUDE_DIR = '/x/y'
    expect(claudeProjectsDir()).toBe(join('/x/y', 'projects'))
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
