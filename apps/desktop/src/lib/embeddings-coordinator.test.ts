import { describe, expect, it } from 'vitest'
import { runExclusiveBackfill } from './embeddings-coordinator'

/**
 * Mutex contract (Bugbot pass 7, "Rebuild races coordinator backfill"): the
 * shared backfill lock must run queued work strictly one-at-a-time so the manual
 * rebuild's `embed_clear` can never interleave with an in-flight incremental
 * pass, and a task throwing must not wedge the queue for the next caller.
 */
describe('runExclusiveBackfill', () => {
  it('runs queued tasks one at a time, in submission order', async () => {
    const events: string[] = []
    let releaseA: () => void = () => {}

    const a = runExclusiveBackfill(async () => {
      events.push('a:start')
      await new Promise<void>((resolve) => {
        releaseA = resolve
      })
      events.push('a:end')
    })
    const b = runExclusiveBackfill(async () => {
      events.push('b:start')
    })

    // Flush microtasks: B must NOT have started while A still holds the lock.
    await Promise.resolve()
    await Promise.resolve()
    expect(events).toEqual(['a:start'])

    releaseA()
    await Promise.all([a, b])
    // B only ran after A fully settled — no interleaving.
    expect(events).toEqual(['a:start', 'a:end', 'b:start'])
  })

  it('keeps serving the queue after a task rejects', async () => {
    const events: string[] = []
    const a = runExclusiveBackfill(async () => {
      events.push('a')
      throw new Error('boom')
    })
    const b = runExclusiveBackfill(async () => {
      events.push('b')
    })

    await expect(a).rejects.toThrow('boom')
    await expect(b).resolves.toBeUndefined()
    expect(events).toEqual(['a', 'b'])
  })
})
