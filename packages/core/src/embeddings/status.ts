import { db } from '../db/client'
import type { DatabaseIdentity } from '../db/identity'
import { getSetting } from '../domains/settings/getters'
import { setSetting } from '../domains/settings/setters'
import { embedStatus } from './commands'
import { type EmbedStatus, EMBEDDING_MODEL_ID } from './model'
import { countPending } from './pipeline'

/**
 * The user-facing semantic-search status (Reflect-embeddings port, Local
 * Brain-shaped): the runtime state, whether the feature is enabled, and how much
 * of the durable content is indexed. The Settings surface reads this; Diagnostics
 * uses it to report the real semantic-search state instead of a hardcoded line.
 */

/** Settings kill-switch: is semantic indexing/search enabled? Opt-in. */
export const EMBEDDINGS_ENABLED_KEY = 'embeddings.enabled'

/**
 * Last incremental-backfill failure, persisted so the UI/coordinator stop
 * pretending indexing is progressing after a backfill threw. The runtime can
 * report `ready` while a backfill (embed/persist) fails mid-pass; without this
 * marker `pending` stays > 0 and the next allowed/manual coordinator pass would
 * repeat the same failing backfill. Cleared on a clean backfill or an explicit
 * user action (re-enable / backfill / rebuild). Null means no pending failure.
 */
export const EMBEDDINGS_BACKFILL_ERROR_KEY = 'embeddings.backfillError'

/** Local calendar day (`YYYY-MM-DD`) of the last automatic/manual backfill attempt. */
export const EMBEDDINGS_LAST_BACKFILL_ATTEMPT_DAY_KEY = 'embeddings.lastBackfillAttemptDay'

export interface EmbeddingsStatus {
  /** Whether the user has turned semantic search on. */
  enabled: boolean
  /** The Rust embedding runtime's state (model download/load). */
  runtime: EmbedStatus
  modelId: string
  /** Content chunks with a current-model vector. */
  indexed: number
  /** Total derived content chunks (the indexing target). */
  totalChunks: number
  /** Chunks still awaiting an embedding for the current model. */
  pending: number
  /** True once the runtime is ready and nothing is pending. */
  ready: boolean
  /** Last incremental-backfill error message, or null when indexing is healthy. */
  backfillError: string | null
  /** Local day key for the last backfill attempt, or null if none has run. */
  lastBackfillAttemptDay: string | null
}

export async function isEmbeddingsEnabled(): Promise<boolean> {
  return getSetting<boolean>(EMBEDDINGS_ENABLED_KEY, false)
}

export async function setEmbeddingsEnabled(
  enabled: boolean,
  identity?: DatabaseIdentity,
): Promise<void> {
  await setSetting(EMBEDDINGS_ENABLED_KEY, enabled, identity)
}

/** The last persisted incremental-backfill failure, or null when healthy. */
export async function getBackfillError(): Promise<string | null> {
  return getSetting<string | null>(EMBEDDINGS_BACKFILL_ERROR_KEY, null)
}

/** Record the last backfill failure, optionally pinned to one open brain. */
export async function setBackfillError(
  message: string | null,
  identity?: DatabaseIdentity,
): Promise<void> {
  await setSetting(EMBEDDINGS_BACKFILL_ERROR_KEY, message, identity)
}

/** Last local calendar day on which a backfill was attempted. */
export async function getLastBackfillAttemptDay(): Promise<string | null> {
  return getSetting<string | null>(EMBEDDINGS_LAST_BACKFILL_ATTEMPT_DAY_KEY, null)
}

/** Record the last backfill day, optionally pinned to one open brain. */
export async function setLastBackfillAttemptDay(
  day: string | null,
  identity?: DatabaseIdentity,
): Promise<void> {
  await setSetting(EMBEDDINGS_LAST_BACKFILL_ATTEMPT_DAY_KEY, day, identity)
}

/** A best-effort runtime poll that degrades to `uninitialized` off-desktop. */
async function safeRuntimeStatus(): Promise<EmbedStatus> {
  try {
    return await embedStatus()
  } catch {
    return { status: 'uninitialized' }
  }
}

export async function getEmbeddingsStatus(): Promise<EmbeddingsStatus> {
  const [enabled, runtime, totalRow, pending, backfillError, lastBackfillAttemptDay] = await Promise.all([
    isEmbeddingsEnabled(),
    safeRuntimeStatus(),
    db
      .selectFrom('contentChunks')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst(),
    countPending(EMBEDDING_MODEL_ID),
    getBackfillError(),
    getLastBackfillAttemptDay(),
  ])

  const totalChunks = Number(totalRow?.count ?? 0)
  const indexed = Math.max(0, totalChunks - pending)
  return {
    enabled,
    runtime,
    modelId: EMBEDDING_MODEL_ID,
    indexed,
    totalChunks,
    pending,
    ready: runtime.status === 'ready' && pending === 0,
    backfillError,
    lastBackfillAttemptDay,
  }
}
