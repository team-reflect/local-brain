import { z } from 'zod'
import { call } from '../ipc/invoke'
import { type EmbedStatus, embedStatusSchema } from './model'

/**
 * Typed bindings for the Rust embedding commands (Reflect-embeddings port).
 * Every call funnels through the validated `call()` boundary; the UI and the
 * pipeline never reach for the bridge directly.
 *
 * Generation/storage split: `embedTexts` turns text into vectors (fastembed),
 * while `embedApply`/`embedDelete`/`embedClear` write the `chunk_embeddings` +
 * `chunk_vectors` projection (the rowid coupling that `db_batch` can't express).
 */

/** One freshly-embedded content chunk to persist. */
export interface EmbeddedChunkInput {
  chunkId: string
  contentHash: string
  modelId: string
  vector: number[]
}

const vectorsSchema = z.array(z.array(z.number()))
const affectedSchema = z.number().int().nonnegative()
const embeddingDatabaseIdentitySchema = z.object({
  databasePath: z.string().min(1),
  generation: z.number().int().nonnegative(),
})

/** Exact active connection an asynchronous embedding pass is bound to. */
export type EmbeddingDatabaseIdentity = z.infer<typeof embeddingDatabaseIdentitySchema>

/** Current runtime status (carries live download progress). Poll this. */
export function embedStatus(): Promise<EmbedStatus> {
  return call('embed_status', {}, embedStatusSchema)
}

/** Capture the active database path + monotonic connection generation. */
export function embedDatabaseIdentity(): Promise<EmbeddingDatabaseIdentity> {
  return call('embed_database_identity', {}, embeddingDatabaseIdentitySchema)
}

/** Structural identity comparison, including the ABA-safe connection generation. */
export function embeddingDatabaseIdentitiesEqual(
  left: EmbeddingDatabaseIdentity,
  right: EmbeddingDatabaseIdentity,
): boolean {
  return left.databasePath === right.databasePath && left.generation === right.generation
}

/** Whether the captured connection is still the active Local Brain database. */
export async function isEmbeddingDatabaseIdentityCurrent(
  expected: EmbeddingDatabaseIdentity,
): Promise<boolean> {
  try {
    return embeddingDatabaseIdentitiesEqual(expected, await embedDatabaseIdentity())
  } catch {
    return false
  }
}

/** Ensure the model is loaded, downloading it on first use. Idempotent. */
export function embedEnsure(): Promise<EmbedStatus> {
  return call('embed_ensure', {}, embedStatusSchema)
}

/** Embed a batch of texts → vectors. Rejects unless the runtime is `ready`. */
export function embedTexts(texts: readonly string[]): Promise<number[][]> {
  return call('embed_texts', { texts }, vectorsSchema)
}

/** Persist a batch of embedded chunks (upsert per chunk+model). */
export function embedApply(
  identity: EmbeddingDatabaseIdentity,
  chunks: readonly EmbeddedChunkInput[],
): Promise<number> {
  return call('embed_apply', {
    expectedDatabasePath: identity.databasePath,
    expectedGeneration: identity.generation,
    chunks,
  }, affectedSchema)
}

/** Drop embeddings for content chunks that no longer exist (pruning). */
export function embedDelete(
  identity: EmbeddingDatabaseIdentity,
  chunkIds: readonly string[],
): Promise<number> {
  return call('embed_delete', {
    expectedDatabasePath: identity.databasePath,
    expectedGeneration: identity.generation,
    chunkIds,
  }, affectedSchema)
}

/** Wipe the whole embedding projection (rebuild / model change). */
export function embedClear(identity: EmbeddingDatabaseIdentity): Promise<number> {
  return call('embed_clear', {
    expectedDatabasePath: identity.databasePath,
    expectedGeneration: identity.generation,
  }, affectedSchema)
}
