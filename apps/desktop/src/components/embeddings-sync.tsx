import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  backfillEmbeddings,
  type BrainInfo,
  type EmbeddingsStatus,
  embedDatabaseIdentity,
  embedEnsure,
  isEmbeddingDatabaseIdentityCurrent,
  setBackfillError,
  setLastBackfillAttemptDay,
} from '@local-brain/core'
import { runExclusiveBackfill } from '../lib/embeddings-coordinator'
import {
  EMBEDDINGS_STATUS_KEY,
  todayLocalDayKey,
  useEmbeddingsStatus,
  withBackfillActive,
} from '../lib/queries'
import { ACTIVE_BRAIN_KEY } from '../lib/queries/brains'
import { errorMessage } from '../lib/utils'

/** Avoid a tight success loop if chunks keep changing while a pass is running. */
const AUTOMATIC_BACKFILL_COOLDOWN_MS = 1_000

/**
 * Headless coordinator for semantic search (Reflect-embeddings port). Mounted
 * once at the app root; renders nothing. When the feature is enabled it loads
 * the model (downloading on first use), follows successful in-app mutations,
 * and periodically checks durable SQLite state for CLI/external writes. Manual
 * Settings actions can still backfill or rebuild on demand.
 */
export function EmbeddingsSync(): null {
  const status = useEmbeddingsStatus()
  const queryClient = useQueryClient()
  const ensuring = useRef(false)
  const backfilling = useRef(false)
  const automaticEnsureBlocked = useRef(false)
  const automaticBackfillBlocked = useRef(false)
  const nextAutomaticAttemptAt = useRef(0)
  const retryTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const mounted = useRef(false)

  const data = status.data

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!data || !data.enabled) {
      automaticEnsureBlocked.current = false
      automaticBackfillBlocked.current = false
      return
    }
    if (data.runtime.status !== 'uninitialized') automaticEnsureBlocked.current = false
    if (data.pending === 0 || data.backfillError) automaticBackfillBlocked.current = false

    // 1. Bring the runtime up (idempotent; the command coalesces concurrent calls).
    //    Only auto-ensure from `uninitialized`. A `failed` runtime means the load
    //    already errored (download/onnx); retrying it on every 1.5s poll would
    //    hammer a permanent failure, so we stop and wait for an explicit user
    //    action — re-enabling the setting or "Rebuild index" both call
    //    `embedEnsure()` directly (see lib/queries/embeddings.ts).
    if (
      data.runtime.status === 'uninitialized' &&
      !ensuring.current &&
      !automaticEnsureBlocked.current
    ) {
      ensuring.current = true
      const settleEnsure = (blocked: boolean): void => {
        automaticEnsureBlocked.current = blocked
        ensuring.current = false
        void queryClient.invalidateQueries({ queryKey: EMBEDDINGS_STATUS_KEY })
      }
      void embedEnsure().then(
        () => settleEnsure(false),
        () => settleEnsure(true),
      )
      return
    }

    // 2. Once ready, embed durable pending chunks. A prior failure is sticky
    //    (`data.backfillError`) and stops automatic work until an explicit
    //    recovery action. Successful passes are briefly throttled so content
    //    changing continuously cannot create a hot renderer loop.
    const today = todayLocalDayKey()
    if (
      data.runtime.status === 'ready' &&
      data.pending > 0 &&
      !data.backfillError &&
      !backfilling.current &&
      !automaticBackfillBlocked.current
    ) {
      const delay = nextAutomaticAttemptAt.current - Date.now()
      if (delay > 0) {
        if (retryTimer.current === null) {
          retryTimer.current = window.setTimeout(() => {
            retryTimer.current = null
            void queryClient.invalidateQueries({ queryKey: EMBEDDINGS_STATUS_KEY })
          }, delay)
        }
        return
      }

      if (retryTimer.current !== null) {
        window.clearTimeout(retryTimer.current)
        retryTimer.current = null
      }
      backfilling.current = true
      const expectedDatabasePath = queryClient.getQueryData<BrainInfo>(ACTIVE_BRAIN_KEY)?.databasePath
      const isStale = (): boolean => {
        const activeDatabasePath = queryClient.getQueryData<BrainInfo>(ACTIVE_BRAIN_KEY)?.databasePath
        return (
          !mounted.current ||
          (expectedDatabasePath !== undefined && activeDatabasePath !== expectedDatabasePath) ||
          queryClient.getQueryData<EmbeddingsStatus>(EMBEDDINGS_STATUS_KEY)?.enabled === false
        )
      }
      nextAutomaticAttemptAt.current = Date.now() + AUTOMATIC_BACKFILL_COOLDOWN_MS
      // Route through the shared mutex so this incremental pass and a manual
      // "Rebuild index" can never run concurrently (the rebuild's wipe could
      // otherwise land mid-pass). Record the backfill outcome INSIDE the
      // exclusive section so "backfill + setBackfillError" is atomic: a stale
      // pass can't clear an error a rebuild recorded in a later locked turn.
      const backfill = withBackfillActive(async () => {
        const identity = await embedDatabaseIdentity()
        if (isStale()) return
        return runExclusiveBackfill(async () => {
          if (isStale() || !(await isEmbeddingDatabaseIdentityCurrent(identity))) return
          try {
            await setLastBackfillAttemptDay(today, identity)
            await backfillEmbeddings({
              databaseIdentity: identity,
              // Observe the LIVE enabled flag from the query cache, not the render
              // snapshot that kicked off this run: disabling semantic search mid-pass
              // must abort the backfill between batches. A captured `status.data` would
              // keep reporting the stale `enabled: true` and let the pass run to the end.
              isStale,
            })
            if (isStale() || !(await isEmbeddingDatabaseIdentityCurrent(identity))) return
            // A clean run (completed or cooperatively aborted on disable) clears any
            // stale marker.
            await setBackfillError(null, identity)
          } catch (error: unknown) {
            if (isStale() || !(await isEmbeddingDatabaseIdentityCurrent(identity))) return
            // A throw is persisted so the status/UI stops pretending indexing is
            // progressing and the poll/retry loop above halts.
            try {
              await setBackfillError(errorMessage(error), identity)
            } catch (settingsError) {
              if (isStale() || !(await isEmbeddingDatabaseIdentityCurrent(identity))) return
              throw settingsError
            }
          }
        })
      })
      void queryClient.invalidateQueries({ queryKey: EMBEDDINGS_STATUS_KEY })
      const settleBackfill = (blocked: boolean): void => {
        automaticBackfillBlocked.current = blocked
        backfilling.current = false
        void queryClient.invalidateQueries({ queryKey: EMBEDDINGS_STATUS_KEY })
      }
      void backfill.then(
        () => settleBackfill(false),
        () => settleBackfill(true),
      )
    }
  }, [data, queryClient])

  useEffect(() => {
    // React Query mutations cover record edits made by this renderer. Their
    // success is a post-write signal, analogous to Reflect's post-index-apply
    // event: invalidate the hash-derived status and let the effect above drain
    // any newly pending chunks. Mutations that do not affect chunks only cause
    // one cheap status read.
    return queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'success') {
        void queryClient.invalidateQueries({ queryKey: EMBEDDINGS_STATUS_KEY })
      }
    })
  }, [queryClient])

  useEffect(() => {
    return () => {
      if (retryTimer.current !== null) {
        window.clearTimeout(retryTimer.current)
        retryTimer.current = null
      }
    }
  }, [])

  return null
}
