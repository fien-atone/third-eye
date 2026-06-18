/*
 * Adapted from CodeBurn (https://github.com/AgentSeal/codeburn)
 * Original Copyright (c) 2025 AgentSeal — MIT License
 * See webapp/THIRD_PARTY_NOTICES.md for full license text.
 */

export type SessionSource = {
  path: string
  project: string
  provider: string
  /** Which configured source this session came from. For Claude
   *  sources, populated by claude.discoverSessions() from
   *  THIRD_EYE_CLAUDE_DIRS (or the singular THIRD_EYE_CLAUDE_DIR
   *  legacy override, contributing alias 'default'). For other
   *  providers there's only one source per provider, so it defaults
   *  to the provider name. Indexed in api_calls.source_alias for
   *  the ?source=<alias> query-param filter. */
  sourceAlias: string
}

export type SessionParser = {
  parse(): AsyncGenerator<ParsedProviderCall>
}

export type ParsedProviderCall = {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  cachedInputTokens: number
  reasoningTokens: number
  webSearchRequests: number
  costUSD: number
  tools: string[]
  timestamp: string
  speed: 'standard' | 'fast'
  deduplicationKey: string
  userMessage: string
  sessionId: string
}

export type Provider = {
  name: string
  displayName: string
  modelDisplayName(model: string): string
  toolDisplayName(rawTool: string): string
  discoverSessions(): Promise<SessionSource[]>
  createSessionParser(source: SessionSource, seenKeys: Set<string>): SessionParser
}
