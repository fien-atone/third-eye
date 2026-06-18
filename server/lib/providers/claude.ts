/*
 * Adapted from CodeBurn (https://github.com/AgentSeal/codeburn)
 * Original Copyright (c) 2025 AgentSeal — MIT License
 * See webapp/THIRD_PARTY_NOTICES.md for full license text.
 */

import { readdir, stat } from 'fs/promises'
import { basename, join } from 'path'

import type { Provider, SessionSource, SessionParser } from './types.js'
import { getShortModelName } from '../models.js'
import { claudeDesktopSessionsDir, claudeHomeDirs, claudeProjectsDir } from '../claude-paths.ts'

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

    // Walk every configured Claude source (THIRD_EYE_CLAUDE_DIRS list,
    // singular THIRD_EYE_CLAUDE_DIR, CLAUDE_CONFIG_DIR, or the
    // ~/.claude fallback). Each source's project dirs become
    // SessionSource rows stamped with that source's alias — so
    // dashboard filtering by ?source=<alias> lands on exactly the
    // rows that came from that Claude root.
    //
    // Different sources with the same project directory name (e.g.
    // ~/.claude-invent/projects/foo and ~/.claude-roman/projects/foo)
    // intentionally stay distinct. The downstream parser keys project
    // rows by (sourceAlias, project) so they don't merge.
    for (const src of claudeHomeDirs()) {
      const projectsDir = claudeProjectsDir(src)
      try {
        const entries = await readdir(projectsDir)
        for (const dirName of entries) {
          const dirPath = join(projectsDir, dirName)
          const dirStat = await stat(dirPath).catch(() => null)
          if (dirStat?.isDirectory()) {
            sources.push({ path: dirPath, project: dirName, provider: 'claude', sourceAlias: src.alias })
          }
        }
      } catch { /* missing dir — silently skip this source */ }
    }

    // Desktop / Cowork ephemeral sessions live outside the Claude
    // root concept — they're per-OS app-data, not per-source. Stamp
    // them with a synthetic alias 'desktop' so the dashboard can
    // optionally hide them via the source filter, but their normal
    // path is to be folded into the "default" Claude bucket.
    const desktopDirs = await findDesktopProjectDirs(claudeDesktopSessionsDir())
    for (const dirPath of desktopDirs) {
      sources.push({ path: dirPath, project: basename(dirPath), provider: 'claude', sourceAlias: 'desktop' })
    }

    return sources
  },

  createSessionParser(source: SessionSource, _seenKeys: Set<string>): SessionParser {
    return {
      async *parse() {},
    }
  },
}
