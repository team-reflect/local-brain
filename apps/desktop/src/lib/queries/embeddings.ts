import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  backfillEmbeddings,
  clearEmbeddings,
  embedEnsure,
  type EmbeddingsStatus,
  getEmbeddingsStatus,
  isEmbedReady,
  setBackfillError,
  setEmbeddingsEnabled,
} from '@local-brain/core'
import { runExclusiveBackfill } from '../embeddings-coordinator'
import { errorMessage } from '../utils'

/**
 * Semantic-search settings hooks (Reflect-embeddings port). The status query
 * polls while the model is loading or a backfill is in flight so the progress
 * bar and indexed count stay live; the mutations drive enable/disable and a
 * full rebuild. The heavy work (download, backfill) runs in `EmbeddingsSync`.
 */

export const EMBEDDINGS_STATUS_KEY = ['embeddings-status'] as const

/** Fast poll while the model downloads/loads or chunks are actively draining. */
const ACTIVE_REFETCH_MS = 1500

/**
 * Slow idle heartbeat once indexing is healthy and caught up. New chunks can be
 * written by a non-UI path — the `brain` CLI indexing while the window is open,
 * or another window — without ever invalidating this query, so a one-shot "stop
 * polling when pending hits 0" would leave them unembedded until the next focus
 * or settings refetch. The heartbeat lets `EmbeddingsSync` notice them on its
 * own. 30s is slow enough not to reintroduce the 1.5s hammering that the
 * failed/backfill-error guards below exist to avoid.
 */
const IDLE_REFETCH_MS = 30_000

/**
 * Decide the status poll cadence from the latest status. Extracted (and exported)
 * so the polling contract can be tested directly without a live React Query timer.
 */
export function embeddingsRefetchInterval(data: EmbeddingsStatus | undefined): number | false {
  if (!data || !data.enabled) return false
  // Don't fast-poll a `failed` runtime or a runtime whose last backfill threw:
  // pending never drains on its own in either case, and `EmbeddingsSync` no
  // longer auto-retries the load or the backfill. Recovery comes from an
  // explicit user action (re-enable / rebuild), whose mutation invalidates
  // this query (and clears the sticky backfill error first).
  if (data.runtime.status === 'failed' || data.backfillError) return false
  // Actively working: model still loading, or chunks waiting to embed.
  if (data.runtime.status === 'loading' || data.pending > 0) return ACTIVE_REFETCH_MS
  // Idle but healthy: heartbeat so externally written chunks get embedded.
  return IDLE_REFETCH_MS
}

export function useEmbeddingsStatus() {
  return useQuery({
    queryKey: EMBEDDINGS_STATUS_KEY,
    queryFn: getEmbeddingsStatus,
    refetchInterval: (query) => embeddingsRefetchInterval(query.state.data),
  })
}

/** Turn semantic search on/off. Enabling also kicks off the model load. */
export function useSetEmbeddingsEnabled() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      await setEmbeddingsEnabled(enabled)
      if (enabled) {
        // Re-enabling is an explicit recovery action: clear any sticky backfill
        // error so the coordinator resumes indexing once the model is ready.
        await setBackfillError(null)
        await embedEnsure()
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: EMBEDDINGS_STATUS_KEY }),
  })
}

/** Optional hooks for a rebuild (kept symmetric with the incremental backfill). */
export interface RebuildOptions {
  /**
   * Abort the rebuild's backfill cooperatively between batches — e.g. semantic
   * search was disabled mid-rebuild. Mirrors `EmbeddingsSync`'s incremental pass
   * so a toggle-off stops embedding work in both code paths, not just one.
   */
  isStale?: () => boolean
}

/**
 * Wipe and rebuild every vector (model change / repair).
 *
 * Bring the runtime up first and ONLY clear the existing projection once the
 * model is confirmed `ready`. `embed_ensure` resolves with `loading` (a
 * concurrent load is already in flight) or `failed` without the model becoming
 * usable, so clearing unconditionally could wipe every vector and then fail the
 * backfill — leaving semantic search empty until a later pass. On a not-ready
 * runtime we throw and leave the existing index untouched.
 *
 * The clear + backfill + error-record runs through {@link runExclusiveBackfill}
 * so it can't interleave with `EmbeddingsSync`'s incremental pass: otherwise the
 * wipe could land while an incremental pass is draining an earlier pending
 * snapshot (leaving the corpus partly unembedded), or a stale pass finishing
 * afterwards could clear the failure this rebuild recorded.
 */
export async function rebuildEmbeddings(options: RebuildOptions = {}): Promise<void> {
  const status = await embedEnsure()
  if (!isEmbedReady(status)) {
    throw new Error(
      status.status === 'failed'
        ? `Embedding model failed to load: ${status.message}`
        : 'Embedding model is still loading; rebuild once it is ready.',
    )
  }
  await runExclusiveBackfill(async () => {
    // Rebuild is an explicit recovery action: clear the sticky backfill error so a
    // success leaves a clean status, but re-persist it if this rebuild also throws
    // so the UI keeps reporting the failure instead of silently pretending again.
    await setBackfillError(null)
    await clearEmbeddings()
    try {
      // Pass `isStale` so disabling semantic search mid-rebuild aborts between
      // batches, exactly like the incremental coordinator pass.
      await backfillEmbeddings(
        options.isStale === undefined ? {} : { isStale: options.isStale },
      )
    } catch (error) {
      await setBackfillError(errorMessage(error))
      throw error
    }
  })
}

/** Wipe and rebuild every vector (model change / repair). */
export function useRebuildEmbeddings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      rebuildEmbeddings({
        // Observe the LIVE enabled flag from the query cache so toggling semantic
        // search off mid-rebuild aborts the backfill between batches, matching
        // `EmbeddingsSync`. A captured snapshot would let the rebuild run on.
        isStale: () =>
          queryClient.getQueryData<EmbeddingsStatus>(EMBEDDINGS_STATUS_KEY)?.enabled === false,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: EMBEDDINGS_STATUS_KEY }),
  })
}
