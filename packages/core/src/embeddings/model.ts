import { z } from 'zod'

/**
 * The local embedding model contract (Reflect-embeddings port). The runtime
 * itself lives in Rust (fastembed/ONNX, desktop only); this module is the typed
 * view the core and UI share. Semantic search is strictly additive: when the
 * model isn't `ready`, retrieval degrades to lexical and nothing here throws on
 * the read path.
 */

/** Recorded per vector; a change forces a re-embed (the rebuild key). */
export const EMBEDDING_MODEL_ID = 'all-MiniLM-L6-v2'

/** all-MiniLM-L6-v2 output width. Mirrors the `vec0(embedding float[384])` table. */
export const EMBEDDING_DIMENSIONS = 384

/** Byte counts for an in-flight model download (first run is ~90MB). */
export const byteProgressSchema = z.object({
  downloaded: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
})
export type ByteProgress = z.infer<typeof byteProgressSchema>

/**
 * The Rust embedding runtime's status, mirrored from the `embed_status` /
 * `embed_ensure` commands. A discriminated union on `status` matching the Rust
 * `EmbedStatus` enum's camelCase serialization.
 */
export const embedStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('uninitialized') }),
  z.object({ status: z.literal('loading'), progress: byteProgressSchema.optional() }),
  z.object({ status: z.literal('ready'), model: z.string() }),
  z.object({ status: z.literal('failed'), message: z.string() }),
])
export type EmbedStatus = z.infer<typeof embedStatusSchema>

/** Whether the runtime can embed text right now. */
export function isEmbedReady(status: EmbedStatus): status is { status: 'ready'; model: string } {
  return status.status === 'ready'
}
