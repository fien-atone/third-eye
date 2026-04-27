/**
 * Env-var reader with legacy-prefix fallback.
 *
 * The project was forked from CodeBurn and inherited its `CODEBURN_*`
 * env-var namespace. Going forward the project is `third-eye`, so all
 * new code reads `THIRD_EYE_*`. To avoid breaking existing deployments
 * (docker-compose overrides, user-authored `.env` files, shell exports
 * in muscle memory) we silently accept BOTH prefixes, preferring the
 * new one.
 *
 * No deprecation warnings to console — users don't read logs; surfacing
 * the debt to them is useless and annoying. The legacy read stays
 * documented here as a code comment, tracked in CHANGELOG as "planned
 * removal in v3.0", and eventually dies in one clean release bump with
 * a single line in the release notes.
 *
 * Usage:
 *   const host = envRead('THIRD_EYE_HOST', 'CODEBURN_HOST') ?? '127.0.0.1'
 *   const n    = envReadNumber('THIRD_EYE_INGEST_INTERVAL_MIN', 'CODEBURN_INGEST_INTERVAL_MIN') ?? 0
 */

/** Read a string env var, preferring primary over legacy. Returns undefined
 *  if neither is set. Empty string is treated as "unset" — matches how
 *  docker-compose empty values tend to behave in practice. */
export function envRead(primary: string, legacy?: string): string | undefined {
  const p = process.env[primary]
  if (p !== undefined && p !== '') return p
  if (legacy) {
    const l = process.env[legacy]
    if (l !== undefined && l !== '') return l
  }
  return undefined
}

/** Same as `envRead` but parses the result as a number. Returns undefined
 *  on parse failure so the caller can substitute a default cleanly. */
export function envReadNumber(primary: string, legacy?: string): number | undefined {
  const raw = envRead(primary, legacy)
  if (raw === undefined) return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}
