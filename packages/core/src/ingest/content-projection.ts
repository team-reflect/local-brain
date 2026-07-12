import type { Compilable } from 'kysely'
import { db, dbForDatabase } from '../db/client'
import { newId } from '../db/id'
import { activeDatabaseIdentity, type DatabaseIdentity } from '../db/identity'
import { chunkText } from './chunk'
import { contentHash } from './hash'

/** Durable record types whose TypeScript write paths own this projection. */
export type ProjectedContentRecordType =
  | 'person'
  | 'organization'
  | 'document'
  | 'interaction'
  | 'memory'

export interface ContentChunkProjectionOptions {
  /** Bind the projection read and the caller's final batch to one open brain. */
  databaseIdentity?: DatabaseIdentity
  /** A new record cannot have existing chunks, so its projection skips the read. */
  readExisting?: boolean
}

/**
 * A transaction-ready rebuild of one record's derived `content_chunks` rows.
 *
 * Existing chunk ids are deliberately preserved by upserting on
 * `(record_type, record_id, chunk_index)`. Evidence references point at those
 * ids, so deleting every row before a rebuild would silently discard valid
 * citations even when the corresponding chunk index still exists. An evidence
 * ref to a changed index remains a reference to that stable source location and
 * resolves to the current chunk text; any now-invalid quote offsets are cleared.
 * Chunks past the new end are removed after the upserts; their evidence is no
 * longer grounded in source text and follows the schema's cascade policy.
 *
 * Callers must place these statements in the same {@link import('../db/commands').batch}
 * as the owning record insert/update. This function only compiles the derived
 * durable writes so it can be shared by domain setters and ingestion.
 *
 * Embeddings remain an asynchronous, failure-isolated projection. Semantic
 * reads hash-gate vectors against the current chunk row, so this durable write
 * does not need to synchronously delete vectors: changed vectors become inert
 * immediately and removed chunks become harmless orphans until live backfill
 * replaces/prunes them.
 */
export async function contentChunkProjection(
  recordType: ProjectedContentRecordType,
  recordId: string,
  text: string | null | undefined,
  options: ContentChunkProjectionOptions = {},
): Promise<{ statements: Compilable[]; chunkCount: number; databaseIdentity: DatabaseIdentity }> {
  const identity = options.databaseIdentity ?? (await activeDatabaseIdentity())
  const chunks = chunkText(text ?? '')
  const projected = await Promise.all(
    chunks.map(async (chunk) => ({ ...chunk, contentHash: await contentHash(chunk.text) })),
  )
  const existingRows = options.readExisting === false
    ? []
    : await dbForDatabase(identity)
        .selectFrom('contentChunks')
        .select(['id', 'chunkIndex', 'contentHash'])
        .where('recordType', '=', recordType)
        .where('recordId', '=', recordId)
        .execute()
  // The IPC boundary guarantees this shape in production. The narrow guard
  // also keeps lightweight command-capture tests from treating an unrelated
  // canned row as a real chunk.
  const existing = existingRows.filter(
    (chunk) => typeof chunk.id === 'string' && typeof chunk.chunkIndex === 'number',
  )
  const projectedByIndex = new Map(projected.map((chunk) => [chunk.index, chunk]))
  const invalidated = existing.filter((chunk) => {
    const replacement = projectedByIndex.get(chunk.chunkIndex)
    return !replacement || replacement.contentHash !== chunk.contentHash
  })
  const invalidatedOffsets = invalidated
    .filter((chunk) => projectedByIndex.has(chunk.chunkIndex))
    .map((chunk) =>
      db
        .updateTable('evidenceRefs')
        .set({ quoteStart: null, quoteEnd: null })
        .where('chunkId', '=', chunk.id),
    )
  const upserts = projected.map((chunk) => {
    return db
      .insertInto('contentChunks')
      .values({
        id: newId(),
        recordType,
        recordId,
        chunkIndex: chunk.index,
        text: chunk.text,
        contentHash: chunk.contentHash,
      })
      .onConflict((conflict) =>
        conflict.columns(['recordType', 'recordId', 'chunkIndex']).doUpdateSet({
          text: chunk.text,
          contentHash: chunk.contentHash,
          // Any prior tokenization described the superseded text.
          tokenCount: null,
        }),
      )
  })

  return {
    statements: [
      ...upserts,
      ...invalidatedOffsets,
      db
        .deleteFrom('contentChunks')
        .where('recordType', '=', recordType)
        .where('recordId', '=', recordId)
        .where('chunkIndex', '>=', chunks.length),
    ],
    chunkCount: chunks.length,
    databaseIdentity: identity,
  }
}
