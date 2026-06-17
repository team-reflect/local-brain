import { db } from '../../db/client'

/**
 * Evidence / citations. An `evidence_refs` row ties a *subject* (e.g. a memory)
 * to a *content chunk* — a slice of a document or interaction — so the UI can
 * show what a fact or automation was grounded in. Two directions are useful:
 *
 * - {@link listCitationsForSubject}: the sources backing a subject (a memory's
 *   supporting quotes).
 * - {@link listEvidenceFromDocument}: the subjects that cite a document (what a
 *   document has been used as evidence for).
 */

export interface Citation {
  /** evidence_refs id */
  id: string
  note: string | null
  /** The cited chunk text. */
  quote: string
  /** The record the chunk belongs to (its source). */
  sourceType: string
  sourceId: string
  sourceTitle: string | null
}

export function listCitationsForSubject(
  subjectType: string,
  subjectId: string,
): Promise<Citation[]> {
  return db
    .selectFrom('evidenceRefs')
    .innerJoin('contentChunks', 'contentChunks.id', 'evidenceRefs.chunkId')
    .leftJoin('documents', (join) =>
      join
        .onRef('documents.id', '=', 'contentChunks.recordId')
        .on('contentChunks.recordType', '=', 'document'),
    )
    .leftJoin('interactions', (join) =>
      join
        .onRef('interactions.id', '=', 'contentChunks.recordId')
        .on('contentChunks.recordType', '=', 'interaction'),
    )
    .where('evidenceRefs.subjectType', '=', subjectType)
    .where('evidenceRefs.subjectId', '=', subjectId)
    .orderBy('evidenceRefs.createdAt', 'asc')
    .select((eb) => [
      'evidenceRefs.id as id',
      'evidenceRefs.note as note',
      'contentChunks.text as quote',
      'contentChunks.recordType as sourceType',
      'contentChunks.recordId as sourceId',
      eb.fn.coalesce('documents.title', 'interactions.title').as('sourceTitle'),
    ])
    .execute()
}

export interface CitingRecord {
  /** evidence_refs id */
  id: string
  note: string | null
  /** The cited chunk text (a slice of this document). */
  quote: string
  /** The subject that cited the document. */
  subjectType: string
  subjectId: string
  /** When the subject is a memory, its claim. */
  claim: string | null
}

/** The subjects (e.g. memories) whose evidence points at a chunk of this document. */
export function listEvidenceFromDocument(documentId: string): Promise<CitingRecord[]> {
  return db
    .selectFrom('evidenceRefs')
    .innerJoin('contentChunks', 'contentChunks.id', 'evidenceRefs.chunkId')
    .leftJoin('memories', (join) =>
      join
        .onRef('memories.id', '=', 'evidenceRefs.subjectId')
        .on('evidenceRefs.subjectType', '=', 'memory'),
    )
    .where('contentChunks.recordType', '=', 'document')
    .where('contentChunks.recordId', '=', documentId)
    .orderBy('evidenceRefs.createdAt', 'asc')
    .select([
      'evidenceRefs.id as id',
      'evidenceRefs.note as note',
      'contentChunks.text as quote',
      'evidenceRefs.subjectType as subjectType',
      'evidenceRefs.subjectId as subjectId',
      'memories.claim as claim',
    ])
    .execute()
}
