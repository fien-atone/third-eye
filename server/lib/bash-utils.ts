/*
 * Adapted from CodeBurn (https://github.com/AgentSeal/codeburn)
 * Original Copyright (c) 2025 AgentSeal — MIT License
 * See webapp/THIRD_PARTY_NOTICES.md for full license text.
 */

import { basename } from 'path'

function stripQuotedStrings(command: string): string {
  return command.replace(/"[^"]*"|'[^']*'/g, match => ' '.repeat(match.length))
}

export function extractBashCommands(command: string): string[] {
  if (!command || !command.trim()) return []

  const stripped = stripQuotedStrings(command)

  const separatorRegex = /\s*(?:&&|;|\|)\s*/g
  const separators: Array<{ start: number; end: number }> = []
  let match: RegExpExecArray | null

  while ((match = separatorRegex.exec(stripped)) !== null) {
    separators.push({ start: match.index, end: match.index + match[0].length })
  }

  const ranges: Array<[number, number]> = []
  let cursor = 0
  for (const sep of separators) {
    ranges.push([cursor, sep.start])
    cursor = sep.end
  }
  ranges.push([cursor, command.length])

  const commands: string[] = []
  for (const [start, end] of ranges) {
    const segment = command.slice(start, end).trim()
    if (!segment) continue

    const firstToken = segment.split(/\s+/)[0]
    const base = basename(firstToken)

    if (base && base !== 'cd') {
      commands.push(base)
    }
  }

  return commands
}
