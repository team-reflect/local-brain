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

interface ExistingProjectionChunk {
  id: string
  chunkIndex: number
  text: string
  contentHash: string | null
}

interface CompactedProjectionChunk extends ExistingProjectionChunk {
  originalChunkIndex: number
}

interface ExactChunkCompactionPlan {
  duplicates: Array<{ duplicateId: string; canonicalId: string }>
  survivors: CompactedProjectionChunk[]
}

/**
 * Plan an id-preserving compaction of legacy byte-identical chunks.
 *
 * The earliest occurrence is canonical. Later duplicates can safely move their
 * evidence refs to it because both the chunk text and quote offsets are exact.
 * Unique survivors retain their ids and source order while their indexes close
 * the holes left by duplicates.
 */
export function planExactChunkCompaction(
  rows: ExistingProjectionChunk[],
): ExactChunkCompactionPlan {
  const ordered = [...rows].sort(
    (left, right) => left.chunkIndex - right.chunkIndex || left.id.localeCompare(right.id),
  )
  const canonicalByText = new Map<string, string>()
  const duplicates: ExactChunkCompactionPlan['duplicates'] = []
  const unique: ExistingProjectionChunk[] = []

  for (const row of ordered) {
    const canonicalId = canonicalByText.get(row.text)
    if (canonicalId) {
      duplicates.push({ duplicateId: row.id, canonicalId })
    } else {
      canonicalByText.set(row.text, row.id)
      unique.push(row)
    }
  }

  return {
    duplicates,
    survivors: unique.map((row, index) => ({
      ...row,
      originalChunkIndex: row.chunkIndex,
      chunkIndex: index,
    })),
  }
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
        .select(['id', 'chunkIndex', 'text', 'contentHash'])
        .where('recordType', '=', recordType)
        .where('recordId', '=', recordId)
        .orderBy('chunkIndex', 'asc')
        .orderBy('id', 'asc')
        .execute()
  // The IPC boundary guarantees this shape in production. The narrow guard
  // also keeps lightweight command-capture tests from treating an unrelated
  // canned row as a real chunk.
  const readableExisting = existingRows.filter(
    (chunk): chunk is ExistingProjectionChunk =>
      typeof chunk.id === 'string' &&
      typeof chunk.chunkIndex === 'number' &&
      typeof chunk.text === 'string',
  )
  const exactCompaction = planExactChunkCompaction(readableExisting)
  const existing = exactCompaction.survivors
  const projectedByIndex = new Map(projected.map((chunk) => [chunk.index, chunk]))
  const invalidated = existing.filter((chunk) => {
    const replacement = projectedByIndex.get(chunk.chunkIndex)
    // A legacy/null hash is projection metadata, not evidence that the source
    // text changed. The upsert below refreshes it; quote offsets remain valid
    // whenever the byte-identical chunk text survives at this stable id.
    return !replacement || replacement.text !== chunk.text
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
      // Repoint citations before deleting duplicate chunks so the evidence FK's
      // cascade cannot discard them. Exact text means quote offsets remain valid.
      ...exactCompaction.duplicates.map((duplicate) =>
        db
          .updateTable('evidenceRefs')
          .set({ chunkId: duplicate.canonicalId })
          .where('chunkId', '=', duplicate.duplicateId),
      ),
      ...exactCompaction.duplicates.map((duplicate) =>
        db.deleteFrom('contentChunks').where('id', '=', duplicate.duplicateId),
      ),
      // Move unique survivors into the holes while retaining their stable ids.
      ...existing
        .filter((chunk) => chunk.originalChunkIndex !== chunk.chunkIndex)
        .map((chunk) =>
          db
            .updateTable('contentChunks')
            .set({ chunkIndex: chunk.chunkIndex })
            .where('id', '=', chunk.id),
        ),
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
