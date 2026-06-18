/**
 * Serializes embedding backfill-class work in the renderer (Bugbot pass 7,
 * "Rebuild races coordinator backfill").
 *
 * The headless `EmbeddingsSync` incremental pass and the manual "Rebuild index"
 * action both mutate the same `chunk_embeddings`/`chunk_vectors` projection.
 * Without a shared lock a rebuild could run `embed_clear` + a full backfill
 * while an incremental pass is still draining an earlier in-memory pending
 * snapshot: the wipe lands mid-pass and the corpus is left partly unembedded,
 * and a stale pass finishing afterwards could `setBackfillError(null)` over a
 * failure the rebuild just recorded.
 *
 * A single in-flight promise chain — a process-wide mutex for the one renderer —
 * makes these mutually exclusive: a rebuild waits for any in-flight incremental
 * pass to settle (and persist its outcome) before it clears, and an incremental
 * pass started afterwards waits for the rebuild. Callers that record the
 * backfill error (clear-on-success / persist-on-failure) must do so *inside* the
 * exclusive section so the whole "backfill + record outcome" step is atomic with
 * respect to other backfill-class work.
 */

let tail: Promise<unknown> = Promise.resolve()

/**
 * Run `fn` after every previously-queued backfill/rebuild has settled. A prior
 * task's failure doesn't break the chain — the next caller still runs — but each
 * caller observes its own `fn`'s resolution/rejection through the returned
 * promise.
 */
export function runExclusiveBackfill<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn)
  // Keep the chain progressing regardless of how `fn` settles; the swallow here
  // only governs queue ordering, never what the caller sees.
  tail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
