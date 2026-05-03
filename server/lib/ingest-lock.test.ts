import { describe, it, expect } from 'vitest'
import { withIngestLock, getActiveIngest, IngestBusyError } from './ingest-lock.ts'

/** A tiny helper that resolves on demand. Lets a test "hold" an
 *  ingest in flight to drive the busy-path branches deterministically
 *  without timers or sleep. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

describe('withIngestLock', () => {
  it('runs sequential calls back-to-back, no dedup flag', async () => {
    const a = await withIngestLock('full', 'dedup', async () => 'A')
    const b = await withIngestLock('full', 'dedup', async () => 'B')
    expect(a).toEqual({ result: 'A', deduped: false })
    expect(b).toEqual({ result: 'B', deduped: false })
  })

  it('dedup: second concurrent call piggy-backs on the first', async () => {
    const d = deferred<string>()
    const first = withIngestLock('incremental', 'dedup', () => d.promise)
    // Second call arrives while the first is still in-flight (the
    // deferred hasn't resolved yet). It must NOT spawn a new fn —
    // it should adopt the first's eventual result.
    let secondFnCalled = false
    const second = withIngestLock('incremental', 'dedup', async () => {
      secondFnCalled = true
      return 'SHOULD-NOT-RUN'
    })
    d.resolve('FIRST')
    const [a, b] = await Promise.all([first, second])
    expect(a).toEqual({ result: 'FIRST', deduped: false })
    expect(b).toEqual({ result: 'FIRST', deduped: true })
    expect(secondFnCalled).toBe(false)
  })

  it('refuse: throws IngestBusyError while another op is in flight', async () => {
    const d = deferred<string>()
    const first = withIngestLock('incremental', 'dedup', () => d.promise)
    let caught: unknown = null
    try {
      await withIngestLock('rebuild', 'refuse', async () => 'never')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(IngestBusyError)
    expect((caught as IngestBusyError).currentKind).toBe('incremental')
    d.resolve('done')
    await first
  })

  it('releases the lock on completion so the next call runs fresh', async () => {
    const d1 = deferred<string>()
    const r1 = withIngestLock('full', 'dedup', () => d1.promise)
    expect(getActiveIngest()?.kind).toBe('full')
    d1.resolve('x')
    await r1
    expect(getActiveIngest()).toBeNull()
    // And a subsequent call sees no in-flight, so deduped=false.
    const r2 = await withIngestLock('full', 'dedup', async () => 'y')
    expect(r2.deduped).toBe(false)
  })

  it('releases the lock on rejection too (no permanent stall)', async () => {
    const failed = withIngestLock('full', 'dedup', async () => {
      throw new Error('boom')
    })
    await expect(failed).rejects.toThrow('boom')
    // Critical: after a thrown ingest, the lock must be released.
    // Otherwise every subsequent call would dedup onto a rejected
    // Promise forever.
    expect(getActiveIngest()).toBeNull()
    const r = await withIngestLock('full', 'dedup', async () => 'after-error')
    expect(r).toEqual({ result: 'after-error', deduped: false })
  })
})
