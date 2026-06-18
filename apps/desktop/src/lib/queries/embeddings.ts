import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  backfillEmbeddings,
  clearEmbeddings,
  embedEnsure,
  getEmbeddingsStatus,
  isEmbedReady,
  setEmbeddingsEnabled,
} from '@local-brain/core'

/**
 * Semantic-search settings hooks (Reflect-embeddings port). The status query
 * polls while the model is loading or a backfill is in flight so the progress
 * bar and indexed count stay live; the mutations drive enable/disable and a
 * full rebuild. The heavy work (download, backfill) runs in `EmbeddingsSync`.
 */

export const EMBEDDINGS_STATUS_KEY = ['embeddings-status'] as const

export function useEmbeddingsStatus() {
  return useQuery({
    queryKey: EMBEDDINGS_STATUS_KEY,
    queryFn: getEmbeddingsStatus,
    // Poll while the model downloads/loads or chunks remain to embed.
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data || !data.enabled) return false
      const busy = data.runtime.status === 'loading' || data.pending > 0
      return busy ? 1500 : false
    },
  })
}

/** Turn semantic search on/off. Enabling also kicks off the model load. */
export function useSetEmbeddingsEnabled() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      await setEmbeddingsEnabled(enabled)
      if (enabled) await embedEnsure()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: EMBEDDINGS_STATUS_KEY }),
  })
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
 */
export async function rebuildEmbeddings(): Promise<void> {
  const status = await embedEnsure()
  if (!isEmbedReady(status)) {
    throw new Error(
      status.status === 'failed'
        ? `Embedding model failed to load: ${status.message}`
        : 'Embedding model is still loading; rebuild once it is ready.',
    )
  }
  await clearEmbeddings()
  await backfillEmbeddings()
}

/** Wipe and rebuild every vector (model change / repair). */
export function useRebuildEmbeddings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: rebuildEmbeddings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: EMBEDDINGS_STATUS_KEY }),
  })
}
