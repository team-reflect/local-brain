import { db } from '../db/client'
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
}

export async function isEmbeddingsEnabled(): Promise<boolean> {
  return getSetting<boolean>(EMBEDDINGS_ENABLED_KEY, false)
}

export async function setEmbeddingsEnabled(enabled: boolean): Promise<void> {
  await setSetting(EMBEDDINGS_ENABLED_KEY, enabled)
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
  const [enabled, runtime, totalRow, pending] = await Promise.all([
    isEmbeddingsEnabled(),
    safeRuntimeStatus(),
    db
      .selectFrom('contentChunks')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirst(),
    countPending(EMBEDDING_MODEL_ID),
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
  }
}
