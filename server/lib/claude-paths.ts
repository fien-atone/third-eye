/**
 * Single source of truth for Claude Code's data paths.
 *
 * Resolution priority for the Claude root directory:
 *   1. THIRD_EYE_CLAUDE_DIRS  — comma-separated list of Claude Code
 *      config roots, paired with THIRD_EYE_CLAUDE_DIR_ALIASES (also
 *      comma-separated) for the alias each root is exposed as in
 *      the dashboard. First entry's alias defaults to 'default' if
 *      the ALIASES env is unset; later entries get auto-derived
 *      aliases from the path basename.
 *   2. THIRD_EYE_CLAUDE_DIR   — singular legacy override, contributes
 *      a single source with alias 'default'. Backwards-compat with
 *      v2.6.x and earlier.
 *   3. CLAUDE_CONFIG_DIR      — Claude Code's own env var, when set
 *      AND neither of the above is set, contributes a single source
 *      with alias 'default'.
 *   4. ~/.claude              — last-resort default if it exists.
 *
 * Two layouts under the root:
 *   <root>/projects/<project-key>/...     — main session JSONLs
 *                                            and per-session
 *                                            <session>/subagents/
 *                                            sub-folders.
 *
 * Plus two side stores that aren't under the Claude root:
 *   - Desktop / Cowork ephemeral sessions: per-OS application-data
 *     directory under "Claude/local-agent-mode-sessions".
 *   - Task tool output streams: /private/tmp/claude-<uid>/ on macOS,
 *     /tmp/claude-<uid>/ on Linux. Windows has no equivalent — Task
 *     outputs simply don't exist there.
 *
 * Cross-platform safety: every path is built with `join`, never with
 * string literals or hard-coded separators. `homedir()` returns the
 * correct absolute home on macOS, Linux, and Windows.
 */

import { homedir, platform } from 'os'
import { basename, isAbsolute, join } from 'path'
import { existsSync } from 'fs'
import { envRead } from './env.ts'

export type ClaudeSource = { path: string; alias: string }

const ALIAS_RE = /^[a-z0-9_-]{1,32}$/

/** Normalise an alias candidate to lowercase and validate. Throws at
 *  module-load if the input is malformed (fail-fast — don't silently
 *  fall back to a defaulted name, the user needs to know their env
 *  var is wrong). */
function normaliseAlias(raw: string): string {
  const lower = raw.toLowerCase()
  if (!ALIAS_RE.test(lower)) {
    throw new Error(
      `invalid Claude source alias "${raw}": must match ${ALIAS_RE.source} (case-insensitive, lowercased to "${lower}")`,
    )
  }
  return lower
}

/** Derive a deterministic alias from a configured path when the user
 *  didn't supply one. We use the basename of the path (e.g. `claude-b`
 *  for `/a/claude-b`) prefixed with `claude-` if it doesn't already
 *  start with it. Falsy / empty basename → `claude-n` (n = position). */
function autoAliasFor(path: string, index: number): string {
  const base = basename(path) || `claude-${index + 1}`
  const candidate = base.toLowerCase().startsWith('claude-') ? base : `claude-${base}`
  // Truncate to the regex's 32-char ceiling so a long path basename
  // doesn't push us out of the valid alias shape.
  const trimmed = candidate.slice(0, 32)
  // If the candidate fails the regex (e.g. contains dots or other
  // non-allowed chars), fall back to a position-based default.
  return ALIAS_RE.test(trimmed) ? trimmed : `claude-${index + 1}`
}

/** Parse a comma-separated env value, skipping empty entries. */
function parseCsvList(raw: string | undefined | null): string[] {
  if (!raw) return []
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

/** Return every configured Claude root, in declaration order.
 *
 *  - THIRD_EYE_CLAUDE_DIRS / THIRD_EYE_CLAUDE_DIR_ALIASES — comma-separated.
 *  - THIRD_EYE_CLAUDE_DIR (singular) — backward-compat, contributes
 *    { path, alias: 'default' }.
 *  - CLAUDE_CONFIG_DIR — Claude Code's own env, contributes
 *    { path, alias: 'default' } only when no Third Eye env is set.
 *  - ~/.claude — last-resort default if nothing else is set AND it exists.
 *
 *  Validation rules (throw at call time — these are pre-boot, not
 *  mid-ingest, so any failure surfaces immediately in the server log):
 *    - Aliases match ^[a-z0-9_-]{1,32}$ (case-insensitive, normalised
 *      to lowercase).
 *    - Paths are absolute (path.isAbsolute()).
 *    - DIRS and ALIASES have the same length when both are set.
 *    - Empty entries are skipped.
 *    - Duplicate alias: last wins, warn to stderr. */
export function claudeHomeDirs(): ClaudeSource[] {
  const sources: ClaudeSource[] = []
  const seenAliases = new Set<string>()

  // Helper: append a source after dedup-checking the alias. Throws
  // when a path is relative; warns to stderr when the alias collides
  // with a previously-seen one.
  const push = (path: string, alias: string) => {
    if (!isAbsolute(path)) {
      throw new Error(`Claude source path must be absolute: "${path}"`)
    }
    if (seenAliases.has(alias)) {
      console.warn(
        `[claude-paths] duplicate source alias "${alias}" — last value wins (path: ${path})`,
      )
    }
    seenAliases.add(alias)
    sources.push({ path, alias })
  }

  // 1) THIRD_EYE_CLAUDE_DIRS (multi) — preferred when set.
  const multi = parseCsvList(envRead('THIRD_EYE_CLAUDE_DIRS'))
  if (multi.length > 0) {
    const aliasesRaw = parseCsvList(envRead('THIRD_EYE_CLAUDE_DIR_ALIASES'))
    if (aliasesRaw.length > 0 && aliasesRaw.length !== multi.length) {
      throw new Error(
        `THIRD_EYE_CLAUDE_DIRS has ${multi.length} entries but THIRD_EYE_CLAUDE_DIR_ALIASES has ${aliasesRaw.length} — they must match in length (or omit ALIASES to auto-derive)`,
      )
    }
    multi.forEach((p, i) => {
      const alias = aliasesRaw[i]
        ? normaliseAlias(aliasesRaw[i])
        : i === 0
          ? 'default'
          : autoAliasFor(p, i)
      push(p, alias)
    })
    return sources
  }

  // 2) THIRD_EYE_CLAUDE_DIR (singular legacy override).
  const singular = envRead('THIRD_EYE_CLAUDE_DIR')
  if (singular) {
    push(singular, 'default')
    return sources
  }

  // 3) CLAUDE_CONFIG_DIR — Claude Code's own env. Only consulted when
  //    no Third Eye env was set; otherwise it's invisible (matches
  //    the pre-multi-source behaviour where the singular override
  //    won over CLAUDE_CONFIG_DIR).
  const claudeOwn = process.env['CLAUDE_CONFIG_DIR']
  if (claudeOwn && claudeOwn !== '') {
    push(claudeOwn, 'default')
    return sources
  }

  // 4) ~/.claude — default install location, but only if it exists.
  //    We DON'T throw when it doesn't (a fresh install / container
  //    might not have one yet). The caller treats [] as "no sources
  //    configured" and the dashboard renders an empty state.
  const defaultPath = join(homedir(), '.claude')
  if (existsSync(defaultPath)) {
    push(defaultPath, 'default')
  }

  return sources
}

/** Backward-compat shim: the legacy single-root function. Returns
 *  the first configured source's path, or ~/.claude if nothing is
 *  configured. Callers that don't care about the multi-source story
 *  (e.g. the desktop / task side stores, which are per-OS and
 *  outside the Claude root concept) keep working unchanged. */
export function claudeHomeDir(): string {
  const dirs = claudeHomeDirs()
  if (dirs.length > 0) return dirs[0]!.path
  // Fall back to the literal default — even if it doesn't exist on
  // disk. This matches the old `claudeHomeDir` shape exactly so any
  // pre-multi-source caller that does e.g. `path.join(dir, 'foo')`
  // still gets a sensible string.
  return join(homedir(), '.claude')
}

/** <claude root>/projects — where the main session JSONLs live, plus
 *  <project>/<session>/subagents/ subfolders. Now takes an explicit
 *  source so multi-source callers (provider discovery, agent
 *  sessions) iterate over all configured roots. The zero-arg form
 *  is retained for legacy callers (e.g. anything that hasn't been
 *  updated to multi-source yet) and resolves to the first source. */
export function claudeProjectsDir(source?: ClaudeSource): string {
  const base = source ? source.path : claudeHomeDir()
  return join(base, 'projects')
}

/** Per-OS application data path for Claude Desktop / Cowork
 *  ephemeral sessions. Each OS ships its own conventional location
 *  (Application Support on macOS, AppData on Windows, .config on
 *  Linux per XDG). */
export function claudeDesktopSessionsDir(): string {
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions')
  }
  if (platform() === 'win32') {
    return join(homedir(), 'AppData', 'Roaming', 'Claude', 'local-agent-mode-sessions')
  }
  return join(homedir(), '.config', 'Claude', 'local-agent-mode-sessions')
}

/** Task tool output base dirs to probe. Empty array on Windows —
 *  Task outputs are a Unix-only flow; their absence on Windows is
 *  expected, not an error. */
export function claudeTaskBaseDirs(): string[] {
  if (platform() === 'win32') return []
  // process.getuid is undefined on Windows, but we already returned
  // above; safe to call here. Default to 501 (typical first macOS
  // user) if for any reason getuid is missing.
  const uid = (process.getuid?.() ?? 501).toString()
  return [
    join('/private', 'tmp', `claude-${uid}`),
    join('/tmp', `claude-${uid}`),
  ]
}
