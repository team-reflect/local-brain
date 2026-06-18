import { sql } from 'kysely'
import { db } from '../db/client'
import { batch } from '../db/commands'
import { contentHash } from '../ingest/hash'
import { type EmbeddedChunkInput, embedApply, embedClear, embedDelete, embedTexts } from './commands'
import { EMBEDDING_MODEL_ID } from './model'

/**
 * The embedding backfill pipeline (Reflect-embeddings port), adapted to Local
 * Brain's durable `content_chunks` table. Chunk text is the unit; vectors are a
 * rebuildable projection. Backfill is incremental and idempotent via hash-skip:
 * a chunk is only re-embedded when its text hash (for the current model) has no
 * stored vector, so re-runs after a partial pass are cheap.
 *
 * Generation runs in the Rust runtime (fastembed); this module orchestrates
 * which chunks to embed and persists the results through `embedApply`.
 */

/** How many chunk texts to embed per `embed_texts` call. */
const EMBED_BATCH = 32

export interface BackfillProgress {
  /** Chunks embedded so far this run. */
  done: number
  /** Chunks that needed embedding when the run started. */
  total: number
}

export interface BackfillOptions {
  modelId?: string
  onProgress?: (progress: BackfillProgress) => void
  /** Abort cooperatively between batches (e.g. semantic search was disabled). */
  isStale?: () => boolean
}

export interface BackfillResult {
  status: 'completed' | 'aborted'
  embedded: number
  pruned: number
}

interface PendingChunk {
  chunkId: string
  text: string
  contentHash: string
}

/**
 * The pending predicate, expressed in SQL so both the count (status path) and the
 * backfill share it. A chunk is "pending" when, for the current model, no
 * `chunk_embeddings` row exists whose stored `content_hash` matches the chunk's
 * own `content_hash` (`content_chunks.content_hash`, written at ingest). The
 * left join is keyed on `model_id`, so a model change leaves every chunk
 * unmatched and re-embeds the corpus; the null-safe `IS NOT` also flags chunks
 * whose text (hence hash) changed, and chunks with no stored hash yet.
 */
function pendingQuery(modelId: string) {
  return db
    .selectFrom('contentChunks as cc')
    .leftJoin('chunkEmbeddings as ce', (join) =>
      join.onRef('ce.chunkId', '=', 'cc.id').on('ce.modelId', '=', modelId),
    )
    .where((eb) =>
      eb.or([eb('ce.id', 'is', null), sql<boolean>`ce.content_hash is not cc.content_hash`]),
    )
}

/**
 * Backfill `content_chunks.content_hash` for chunks written before it was
 * populated (older rows, or the seed). One-time per legacy chunk: once stored,
 * the status count and the pending query compare hashes in SQL with no JS
 * hashing, keeping polling cheap on large libraries.
 */
async function ensureChunkHashes(): Promise<void> {
  const rows = await db
    .selectFrom('contentChunks')
    .select(['id', 'text'])
    .where('contentHash', 'is', null)
    .execute()
  if (rows.length === 0) return
  const updates = await Promise.all(
    rows.map(async (row) =>
      db.updateTable('contentChunks').set({ contentHash: await contentHash(row.text) }).where('id', '=', row.id),
    ),
  )
  await batch(updates)
}

/**
 * Content chunks lacking a current-model vector, with the stored text hash to
 * embed against. `ensureChunkHashes` runs first, so `content_hash` is populated
 * and no chunk is re-hashed here (the fallback only guards a chunk slipping in
 * between that backfill and this read).
 */
async function pendingChunks(modelId: string): Promise<PendingChunk[]> {
  const rows = await pendingQuery(modelId)
    .select(['cc.id as chunkId', 'cc.text as text', 'cc.contentHash as storedHash'])
    .execute()

  const pending: PendingChunk[] = []
  for (const row of rows) {
    const hash = row.storedHash ?? (await contentHash(row.text))
    pending.push({ chunkId: row.chunkId, text: row.text, contentHash: hash })
  }
  return pending
}

/**
 * Count chunks that still need embedding for the current model. Pure SQL: it
 * never loads chunk text or hashes anything, so the status poll stays cheap.
 */
export async function countPending(modelId: string = EMBEDDING_MODEL_ID): Promise<number> {
  const row = await pendingQuery(modelId)
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .executeTakeFirst()
  return Number(row?.count ?? 0)
}

/**
 * Drop embeddings whose source content chunk no longer exists. Re-ingestion
 * replaces chunk rows, so orphaned vectors are pruned rather than cascaded.
 * Returns the number of orphaned chunk ids removed.
 */
export async function pruneOrphanEmbeddings(): Promise<number> {
  const orphans = await db
    .selectFrom('chunkEmbeddings as ce')
    .leftJoin('contentChunks as cc', 'cc.id', 'ce.chunkId')
    .where('cc.id', 'is', null)
    .select('ce.chunkId as chunkId')
    .distinct()
    .execute()
  const ids = orphans.map((row) => row.chunkId)
  if (ids.length === 0) return 0
  await embedDelete(ids)
  return ids.length
}

/**
 * Embed every pending chunk in batches and persist the vectors. Idempotent and
 * resumable: a second run after a partial pass only embeds what's still missing.
 * Prunes orphaned vectors first so a rebuild can't leave dangling rows.
 */
export async function backfillEmbeddings(options: BackfillOptions = {}): Promise<BackfillResult> {
  const modelId = options.modelId ?? EMBEDDING_MODEL_ID
  await ensureChunkHashes()
  const pruned = await pruneOrphanEmbeddings()

  const pending = await pendingChunks(modelId)
  const total = pending.length
  let done = 0
  options.onProgress?.({ done, total })

  for (let i = 0; i < pending.length; i += EMBED_BATCH) {
    if (options.isStale?.()) return { status: 'aborted', embedded: done, pruned }

    const batch = pending.slice(i, i + EMBED_BATCH)
    const vectors = await embedTexts(batch.map((chunk) => chunk.text))
    const payload: EmbeddedChunkInput[] = batch.map((chunk, index) => ({
      chunkId: chunk.chunkId,
      contentHash: chunk.contentHash,
      modelId,
      vector: vectors[index] ?? [],
    }))
    await embedApply(payload)
    done += batch.length
    options.onProgress?.({ done, total })
  }

  return { status: 'completed', embedded: done, pruned }
}

/** Wipe the embedding projection (rebuild / model change). */
export async function clearEmbeddings(): Promise<number> {
  return embedClear()
}
