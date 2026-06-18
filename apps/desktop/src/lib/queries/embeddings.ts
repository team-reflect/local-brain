import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  backfillEmbeddings,
  clearEmbeddings,
  embedEnsure,
  getEmbeddingsStatus,
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

/** Wipe and rebuild every vector (model change / repair). */
export function useRebuildEmbeddings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await embedEnsure()
      await clearEmbeddings()
      await backfillEmbeddings()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: EMBEDDINGS_STATUS_KEY }),
  })
}
