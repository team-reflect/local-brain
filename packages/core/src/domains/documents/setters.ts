import type { Documents } from '@local-brain/db'
import { db } from '../../db/client'
import { updateContentRecord } from '../../db/content-records'
import { batch } from '../../db/commands'
import { activeDatabaseIdentity, type DatabaseIdentity } from '../../db/identity'
import { newId } from '../../db/id'
import {
  archiveRecord,
  type NewRecord,
  type RecordPatch,
} from '../../db/records'
import { contentChunkProjection } from '../../ingest/content-projection'
import { validateNewDocument, validateDocumentPatch } from './validators'

export type NewDocument = NewRecord<Documents>
export type DocumentPatch = RecordPatch<Documents>

/** Create a document and its body chunks atomically in the captured brain. */
export async function createDocument(
  input: NewDocument,
  expectedIdentity?: DatabaseIdentity,
): Promise<string> {
  const values = validateNewDocument(input)
  const identity = expectedIdentity ?? (await activeDatabaseIdentity())
  const id = newId()
  const projection = await contentChunkProjection('document', id, values.bodyText, {
    databaseIdentity: identity,
    readExisting: false,
  })
  await batch([
    db.insertInto('documents').values({ ...values, id }),
    ...projection.statements,
  ], identity)
  return id
}

/**
 * Update a document, refreshing body chunks in the same transaction when body
 * text changes. A supplied identity rejects stale work after a brain switch.
 */
export function updateDocument(
  id: string,
  patch: DocumentPatch,
  expectedIdentity?: DatabaseIdentity,
): Promise<number> {
  return updateContentRecord('documents', id, validateDocumentPatch(patch), expectedIdentity)
}

export function archiveDocument(id: string): Promise<number> {
  return archiveRecord('documents', id)
}
