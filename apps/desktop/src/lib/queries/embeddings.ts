import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  backfillEmbeddings,
  clearEmbeddings,
  embedDatabaseIdentity,
  embedEnsure,
  isAppError,
  type BrainInfo,
  type EmbeddingsStatus,
  getEmbeddingsStatus,
  isEmbedReady,
  isEmbeddingDatabaseIdentityCurrent,
  setBackfillError,
  setEmbeddingsEnabled,
  setLastBackfillAttemptDay,
} from '@local-brain/core'
import { runExclusiveBackfill } from '../embeddings-coordinator'
import { errorMessage } from '../utils'
import { ACTIVE_BRAIN_KEY } from './brains'

/**
 * Semantic-search settings hooks (Reflect-embeddings port). The status query
 * polls while the model is loading or a backfill is in flight so the progress
 * bar and indexed count stay live; the mutations drive enable/disable and a
 * full rebuild. The heavy work (download, backfill) runs in `EmbeddingsSync`.
 */

export const EMBEDDINGS_STATUS_KEY = ['embeddings-status'] as const

/** Fast poll while the model downloads/loads. */
const ACTIVE_REFETCH_MS = 1500
/**
 * Cheap steady-state discovery poll for writes made outside this renderer
 * (principally the `brain` CLI). `getEmbeddingsStatus` compares stored chunk
 * hashes in SQLite, so this does not load or hash chunk text.
 */
export const EMBEDDINGS_CATCH_UP_REFETCH_MS = 60 * 1000
let activeBackfills = 0

export function withBackfillActive<T>(run: () => Promise<T>): Promise<T> {
  activeBackfills += 1
  return run().finally(() => {
    activeBackfills = Math.max(0, activeBackfills - 1)
  })
}

export function todayLocalDayKey(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

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
  // Actively working: model still loading or an incremental pass is draining.
  if (data.runtime.status === 'loading') return ACTIVE_REFETCH_MS
  if (activeBackfills > 0 && data.pending > 0) return ACTIVE_REFETCH_MS
  // Keep a low-frequency heartbeat even after a successful pass. In-app
  // mutations invalidate this query immediately; the heartbeat is the durable
  // catch-up path for CLI/external writers that cannot signal React Query.
  return EMBEDDINGS_CATCH_UP_REFETCH_MS
}

export function useEmbeddingsStatus() {
  return useQuery({
    queryKey: EMBEDDINGS_STATUS_KEY,
    queryFn: getEmbeddingsStatus,
    refetchInterval: (query) => embeddingsRefetchInterval(query.state.data),
    // CLI writes often happen while the desktop window is not focused. Keep
    // this cheap SQLite hash-status heartbeat alive so the index is current
    // when the user returns, rather than waiting for a focus event to catch up.
    refetchIntervalInBackground: true,
  })
}

/** Turn semantic search on/off. Enabling also kicks off the model load. */
export function useSetEmbeddingsEnabled() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const identity = await embedDatabaseIdentity()
      await setEmbeddingsEnabled(enabled, identity)
      if (enabled) {
        // Re-enabling is an explicit recovery action: clear any sticky backfill
        // error and daily cap so the coordinator resumes indexing once the
        // model is ready.
        await setBackfillError(null, identity)
        await setLastBackfillAttemptDay(null, identity)
        await embedEnsure()
      }
    },
    // Invalidate on settle, not just success: `setEmbeddingsEnabled` /
    // `setBackfillError` persist durable state before `embedEnsure` can throw, so
    // a failed run still changed the DB. Invalidate immediately instead of relying
    // on a later focus refetch or slow poll to correct stale enabled/error state.
    onSettled: () => queryClient.invalidateQueries({ queryKey: EMBEDDINGS_STATUS_KEY }),
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

export interface BackfillNowOptions {
  /**
   * Abort the backfill cooperatively between batches — e.g. semantic search was
   * disabled mid-run. Mirrors rebuild/automatic backfill behavior.
   */
  isStale?: () => boolean
}

/**
 * Non-destructive manual backfill: embed pending chunks without wiping vectors.
 * This bypasses the daily automatic cap, but records today's day key so the
 * automatic coordinator does not immediately repeat the same work.
 */
export async function backfillEmbeddingsNow(options: BackfillNowOptions = {}): Promise<void> {
  await withBackfillActive(async () => {
    const identity = await embedDatabaseIdentity()
    const status = await embedEnsure()
    if (!isEmbedReady(status)) {
      throw new Error(
        status.status === 'failed'
          ? `Embedding model failed to load: ${status.message}`
        : 'Embedding model is still loading; backfill once it is ready.',
      )
    }
    if (options.isStale?.() || !(await isEmbeddingDatabaseIdentityCurrent(identity))) return
    await runExclusiveBackfill(async () => {
      if (options.isStale?.() || !(await isEmbeddingDatabaseIdentityCurrent(identity))) return
      try {
        await setBackfillError(null, identity)
        await setLastBackfillAttemptDay(todayLocalDayKey(), identity)
        await backfillEmbeddings({
          databaseIdentity: identity,
          ...(options.isStale === undefined ? {} : { isStale: options.isStale }),
        })
      } catch (error) {
        if (isAppError(error) && error.kind === 'stale') return
        try {
          await setBackfillError(errorMessage(error), identity)
        } catch (settingsError) {
          if (isAppError(settingsError) && settingsError.kind === 'stale') return
          throw settingsError
        }
        throw error
      }
    })
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
 *
 * The clear + backfill + error-record runs through {@link runExclusiveBackfill}
 * so it can't interleave with `EmbeddingsSync`'s incremental pass: otherwise the
 * wipe could land while an incremental pass is draining an earlier pending
 * snapshot (leaving the corpus partly unembedded), or a stale pass finishing
 * afterwards could clear the failure this rebuild recorded.
 */
export async function rebuildEmbeddings(options: RebuildOptions = {}): Promise<void> {
  await withBackfillActive(async () => {
    const identity = await embedDatabaseIdentity()
    const status = await embedEnsure()
    if (!isEmbedReady(status)) {
      throw new Error(
        status.status === 'failed'
          ? `Embedding model failed to load: ${status.message}`
        : 'Embedding model is still loading; rebuild once it is ready.',
      )
    }
    if (options.isStale?.() || !(await isEmbeddingDatabaseIdentityCurrent(identity))) return
    await runExclusiveBackfill(async () => {
      if (options.isStale?.() || !(await isEmbeddingDatabaseIdentityCurrent(identity))) return
      // Rebuild is an explicit recovery action: clear the sticky backfill error so a
      // success leaves a clean status, but re-persist it if this rebuild also throws
      // so the UI keeps reporting the failure instead of silently pretending again.
      try {
        await setBackfillError(null, identity)
        await clearEmbeddings(identity)
        if (options.isStale?.() || !(await isEmbeddingDatabaseIdentityCurrent(identity))) return
        // Pass `isStale` so disabling semantic search mid-rebuild aborts between
        // batches, exactly like the incremental coordinator pass.
        await backfillEmbeddings({
          databaseIdentity: identity,
          ...(options.isStale === undefined ? {} : { isStale: options.isStale }),
        })
      } catch (error) {
        if (isAppError(error) && error.kind === 'stale') return
        try {
          await setBackfillError(errorMessage(error), identity)
        } catch (settingsError) {
          if (isAppError(settingsError) && settingsError.kind === 'stale') return
          throw settingsError
        }
        throw error
      }
    })
  })
}

/** Wipe and rebuild every vector (model change / repair). */
export function useRebuildEmbeddings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => {
      const expectedDatabasePath = queryClient.getQueryData<BrainInfo>(ACTIVE_BRAIN_KEY)?.databasePath
      const promise = rebuildEmbeddings({
        // Observe the LIVE enabled flag from the query cache so toggling semantic
        // search off mid-rebuild aborts the backfill between batches, matching
        // `EmbeddingsSync`. A captured snapshot would let the rebuild run on.
        isStale: () => {
          const activeDatabasePath = queryClient.getQueryData<BrainInfo>(ACTIVE_BRAIN_KEY)?.databasePath
          return (
            activeDatabasePath !== expectedDatabasePath ||
            queryClient.getQueryData<EmbeddingsStatus>(EMBEDDINGS_STATUS_KEY)?.enabled === false
          )
        },
      })
      void queryClient.invalidateQueries({ queryKey: EMBEDDINGS_STATUS_KEY })
      return promise
    },
    // Invalidate on settle, not just success: a rebuild persists `embed_clear`
    // (and `setBackfillError`) before the backfill can throw, so a failure leaves
    // the index wiped on disk. An onSuccess-only refresh would let Settings keep
    // showing a full/healthy index while the vectors are actually empty until the
    // next poll; on settle the UI reflects the wipe + sticky error immediately.
    onSettled: () => queryClient.invalidateQueries({ queryKey: EMBEDDINGS_STATUS_KEY }),
  })
}

/** Non-destructive manual backfill of pending vectors. */
export function useBackfillEmbeddingsNow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => {
      const expectedDatabasePath = queryClient.getQueryData<BrainInfo>(ACTIVE_BRAIN_KEY)?.databasePath
      const promise = backfillEmbeddingsNow({
        isStale: () => {
          const activeDatabasePath = queryClient.getQueryData<BrainInfo>(ACTIVE_BRAIN_KEY)?.databasePath
          return (
            activeDatabasePath !== expectedDatabasePath ||
            queryClient.getQueryData<EmbeddingsStatus>(EMBEDDINGS_STATUS_KEY)?.enabled === false
          )
        },
      })
      void queryClient.invalidateQueries({ queryKey: EMBEDDINGS_STATUS_KEY })
      return promise
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: EMBEDDINGS_STATUS_KEY }),
  })
}
