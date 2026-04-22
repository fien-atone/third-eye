/*
 * Adapted from CodeBurn (https://github.com/AgentSeal/codeburn)
 * Original Copyright (c) 2025 AgentSeal — MIT License
 * See webapp/THIRD_PARTY_NOTICES.md for full license text.
 */

import { readdir, stat } from 'fs/promises'
import { basename, join } from 'path'
import { homedir } from 'os'

import type { Provider, SessionSource, SessionParser } from './types.js'
import { getShortModelName } from '../models.js'

function getClaudeDir(): string {
  return process.env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude')
}

function getProjectsDir(): string {
  return join(getClaudeDir(), 'projects')
}

function getDesktopSessionsDir(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions')
  if (process.platform === 'win32') return join(homedir(), 'AppData', 'Roaming', 'Claude', 'local-agent-mode-sessions')
  return join(homedir(), '.config', 'Claude', 'local-agent-mode-sessions')
}

async function findDesktopProjectDirs(base: string): Promise<string[]> {
  const results: string[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 8) return
    const entries = await readdir(dir).catch(() => [])
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.git') continue
      const full = join(dir, entry)
      const s = await stat(full).catch(() => null)
      if (!s?.isDirectory()) continue
      if (entry === 'projects') {
        const projectDirs = await readdir(full).catch(() => [])
        for (const pd of projectDirs) {
          const pdFull = join(full, pd)
          const pdStat = await stat(pdFull).catch(() => null)
          if (pdStat?.isDirectory()) results.push(pdFull)
        }
      } else {
        await walk(full, depth + 1)
      }
    }
  }
  await walk(base, 0)
  return results
}

export const claude: Provider = {
  name: 'claude',
  displayName: 'Claude',

  modelDisplayName(model: string): string {
    return getShortModelName(model)
  },

  toolDisplayName(rawTool: string): string {
    return rawTool
  },

  async discoverSessions(): Promise<SessionSource[]> {
    const sources: SessionSource[] = []

    const projectsDir = getProjectsDir()
    try {
      const entries = await readdir(projectsDir)
      for (const dirName of entries) {
        const dirPath = join(projectsDir, dirName)
        const dirStat = await stat(dirPath).catch(() => null)
        if (dirStat?.isDirectory()) {
          sources.push({ path: dirPath, project: dirName, provider: 'claude' })
        }
      }
    } catch {}

    const desktopDirs = await findDesktopProjectDirs(getDesktopSessionsDir())
    for (const dirPath of desktopDirs) {
      sources.push({ path: dirPath, project: basename(dirPath), provider: 'claude' })
    }

    return sources
  },

  createSessionParser(): SessionParser {
    return {
      async *parse() {},
    }
  },
}
