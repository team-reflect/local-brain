import { useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ingestDocument,
  ingestInteraction,
  recomputeAllRelationships,
  seedDemoData,
  type IngestDocumentInput,
  type IngestInteractionInput,
} from '@local-brain/core'

/**
 * First-run seeding and ingestion (paste/import). A new document/interaction
 * touches many lists (links, graph, search, Today), so ingestion invalidates
 * broadly.
 */

/** Seed demo data once on first run, then refresh queries if anything was inserted. */
export function useEnsureSeed(): void {
  const queryClient = useQueryClient()
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void seedDemoData()
      .then(async (result) => {
        if (!result.seeded) return
        // Derive relationship hints (last interaction, reconnect, strength) from
        // the seeded interactions/tasks so Today's reconnect list is populated.
        await recomputeAllRelationships()
        void queryClient.invalidateQueries()
      })
      .catch(() => {
        /* surfaced by the data queries themselves */
      })
  }, [queryClient])
}

export function useIngestDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: IngestDocumentInput) => ingestDocument(input),
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export function useIngestInteraction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: IngestInteractionInput) => ingestInteraction(input),
    onSuccess: () => queryClient.invalidateQueries(),
  })
}
