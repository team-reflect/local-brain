import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  recomputeAllRelationships,
  seedDemoData,
} from '@local-brain/core'

/**
 * First-run seeding. Durable record ingestion is owned by the CLI/agent skill
 * path, not by manual desktop creation surfaces.
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
        // Derive relationship hints (last interaction and strength) from the
        // seeded interactions/tasks.
        await recomputeAllRelationships()
        void queryClient.invalidateQueries()
      })
      .catch(() => {
        /* surfaced by the data queries themselves */
      })
  }, [queryClient])
}
