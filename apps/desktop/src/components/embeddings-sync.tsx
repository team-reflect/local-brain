import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  backfillEmbeddings,
  type EmbeddingsStatus,
  embedEnsure,
  setBackfillError,
} from '@local-brain/core'
import { EMBEDDINGS_STATUS_KEY, useEmbeddingsStatus } from '../lib/queries'
import { errorMessage } from '../lib/utils'

/**
 * Headless coordinator for semantic search (Reflect-embeddings port). Mounted
 * once at the app root; renders nothing. When the feature is enabled it loads
 * the model (downloading on first use) and runs an incremental backfill so new
 * documents/interactions — including those the `brain` CLI wrote while the app
 * was closed — get embedded. Backfill is hash-skip cheap, so re-runs are fine.
 */
export function EmbeddingsSync(): null {
  const status = useEmbeddingsStatus()
  const queryClient = useQueryClient()
  const ensuring = useRef(false)
  const backfilling = useRef(false)

  const data = status.data

  useEffect(() => {
    if (!data || !data.enabled) return

    // 1. Bring the runtime up (idempotent; the command coalesces concurrent calls).
    //    Only auto-ensure from `uninitialized`. A `failed` runtime means the load
    //    already errored (download/onnx); retrying it on every 1.5s poll would
    //    hammer a permanent failure, so we stop and wait for an explicit user
    //    action — re-enabling the setting or "Rebuild index" both call
    //    `embedEnsure()` directly (see lib/queries/embeddings.ts).
    if (data.runtime.status === 'uninitialized' && !ensuring.current) {
      ensuring.current = true
      void embedEnsure().finally(() => {
        ensuring.current = false
        void queryClient.invalidateQueries({ queryKey: EMBEDDINGS_STATUS_KEY })
      })
      return
    }

    // 2. Once ready, embed whatever is still pending. A prior failure is sticky
    //    (`data.backfillError`): pending never drains on its own, so re-running the
    //    same failing backfill on every poll would just hammer it — like the
    //    `failed` runtime above, recovery is an explicit user action (re-enable /
    //    "Rebuild index"), both of which clear the error before retrying.
    if (
      data.runtime.status === 'ready' &&
      data.pending > 0 &&
      !data.backfillError &&
      !backfilling.current
    ) {
      backfilling.current = true
      void backfillEmbeddings({
        // Observe the LIVE enabled flag from the query cache, not the render
        // snapshot that kicked off this run: disabling semantic search mid-pass
        // must abort the backfill between batches. A captured `status.data` would
        // keep reporting the stale `enabled: true` and let the pass run to the end.
        isStale: () =>
          queryClient.getQueryData<EmbeddingsStatus>(EMBEDDINGS_STATUS_KEY)?.enabled === false,
      })
        // A clean run (completed or cooperatively aborted on disable) clears any
        // stale marker; a throw is persisted so the status/UI stops pretending
        // indexing is progressing and the poll/retry loop above halts.
        .then(() => setBackfillError(null))
        .catch((error: unknown) => setBackfillError(errorMessage(error)))
        .finally(() => {
          backfilling.current = false
          void queryClient.invalidateQueries({ queryKey: EMBEDDINGS_STATUS_KEY })
        })
    }
  }, [data, queryClient, status.data])

  return null
}
