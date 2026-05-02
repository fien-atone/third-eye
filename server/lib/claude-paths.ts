/**
 * Single source of truth for Claude Code's data paths.
 *
 * Resolution priority for the Claude root directory:
 *   1. THIRD_EYE_CLAUDE_DIR  — Third Eye-specific override.
 *      Use this when running Third Eye in a container, on a multi-
 *      user system, or pointing at a non-default install (NAS,
 *      symlinked storage, dev/staging side by side, etc.).
 *   2. CLAUDE_CONFIG_DIR     — Claude Code's own env var. If the
 *      user reconfigured Claude Code itself, this is what Claude
 *      Code reads, so we follow.
 *   3. ~/.claude             — default install location.
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
import { join } from 'path'
import { envRead } from './env.ts'

/** Resolve the Claude root (".claude" by default). */
export function claudeHomeDir(): string {
  // THIRD_EYE_CLAUDE_DIR wins. CLAUDE_CONFIG_DIR is read directly
  // (no envRead legacy fallback — it's not Third Eye's namespace).
  const teOverride = envRead('THIRD_EYE_CLAUDE_DIR')
  if (teOverride) return teOverride
  const claudeOverride = process.env['CLAUDE_CONFIG_DIR']
  if (claudeOverride && claudeOverride !== '') return claudeOverride
  return join(homedir(), '.claude')
}

/** <claude root>/projects — where the main session JSONLs live, plus
 *  <project>/<session>/subagents/ subfolders. */
export function claudeProjectsDir(): string {
  return join(claudeHomeDir(), 'projects')
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
