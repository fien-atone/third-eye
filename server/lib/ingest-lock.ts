/** Single-process mutex for ingest operations.
 *
 *  Ingest can be triggered from three sources — manual Refresh,
 *  the auto-tick timer (future), and Full Rebuild — and they MUST
 *  NOT overlap: a rebuild's `truncateAll()` racing with an
 *  incremental's upserts would lose rows; two concurrent fulls
 *  would do double the disk work and fight over `last_ingest_at`.
 *
 *  SQLite's WAL serializes individual writes, but we need to
 *  serialize the WHOLE business operation (walk session dirs →
 *  parse → upsert → set meta). One in-flight Promise on the
 *  module-level `active` ref is enough; third-eye is single-process.
 *  Multi-instance deployments would need a DB-backed lock with TTL
 *  — left for later (YAGNI: nobody's doing this yet). */

export type IngestKind = 'incremental' | 'full' | 'rebuild'

/** Policy for what happens when a new request arrives while an
 *  ingest is already running:
 *  - `dedup` — return the in-flight Promise's eventual result. The
 *    caller gets fresh-as-of-now data without paying for a second
 *    pass. Used by manual Refresh and auto-tick (the user clicked
 *    while we were already ingesting → just wait for it).
 *  - `refuse` — throw with kind=BUSY so the HTTP layer can return
 *    409 Conflict. Used by Rebuild because it does destructive
 *    `truncateAll()` and racing with an in-flight incremental
 *    would corrupt history. The user's UI shows a toast and they
 *    retry once the running op finishes. */
export type LockPolicy = 'dedup' | 'refuse'

export class IngestBusyError extends Error {
  readonly kind = 'BUSY' as const
  constructor(public currentKind: IngestKind, public startedAt: number) {
    super(`ingest busy: ${currentKind} running since ${new Date(startedAt).toISOString()}`)
  }
}

type Active<T> = {
  kind: IngestKind
  startedAt: number
  promise: Promise<T>
}

let active: Active<unknown> | null = null

export function getActiveIngest(): { kind: IngestKind; startedAt: number } | null {
  if (!active) return null
  return { kind: active.kind, startedAt: active.startedAt }
}

/** Run `fn` under the ingest lock. Throws IngestBusyError when
 *  policy=refuse and another op is in flight; returns the in-flight
 *  Promise (cast as T) when policy=dedup.
 *
 *  Note on the dedup type cast: piggy-backing only makes sense when
 *  the in-flight op produces a result shape compatible with what
 *  `fn` would have returned — in practice every ingest path yields
 *  the same `IngestResult` (mode/inserted/skipped/durationMs), so
 *  the cast is sound. If a future caller wants different output
 *  semantics it should use `refuse` instead. */
export async function withIngestLock<T>(
  kind: IngestKind,
  policy: LockPolicy,
  fn: () => Promise<T>,
): Promise<{ result: T; deduped: boolean }> {
  if (active) {
    if (policy === 'refuse') {
      throw new IngestBusyError(active.kind, active.startedAt)
    }
    // dedup: wait on the existing run and return its result. The
    // caller flagged itself as dedup-friendly, so we trust the
    // shape compatibility (see comment above).
    const result = (await active.promise) as T
    return { result, deduped: true }
  }
  const startedAt = Date.now()
  const promise = fn()
  active = { kind, startedAt, promise }
  try {
    const result = await promise
    return { result, deduped: false }
  } finally {
    active = null
  }
}
