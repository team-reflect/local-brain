import type { Documents } from '@local-brain/db'
import { db, dbForDatabase } from '../../db/client'
import { batch } from '../../db/commands'
import { activeDatabaseIdentity, type DatabaseIdentity } from '../../db/identity'
import { newId } from '../../db/id'
import {
  assertTitleOrBody,
  archiveRecord,
  updateRecord,
  type NewRecord,
  type RecordPatch,
} from '../../db/records'
import { nowIso } from '../../db/time'
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
export async function updateDocument(
  id: string,
  patch: DocumentPatch,
  expectedIdentity?: DatabaseIdentity,
): Promise<number> {
  const clean = validateDocumentPatch(patch)
  const identity = expectedIdentity ?? (await activeDatabaseIdentity())
  await assertTitleOrBody('documents', id, clean, 'a document', identity)
  // Non-content edits cannot stale the body projection and should not rewrite
  // it from a pre-transaction read (another process may update the body).
  if (clean.bodyText === undefined) return updateRecord('documents', id, clean, identity)
  const existing = await dbForDatabase(identity)
    .selectFrom('documents')
    .select('id')
    .where('id', '=', id)
    .executeTakeFirst()
  if (!existing) {
    const [affected] = await batch([
      db.updateTable('documents').set({ ...clean, updatedAt: nowIso() }).where('id', '=', id),
    ], identity)
    return affected ?? 0
  }

  const projection = await contentChunkProjection('document', id, clean.bodyText, {
    databaseIdentity: identity,
  })
  const [affected] = await batch([
    db.updateTable('documents').set({ ...clean, updatedAt: nowIso() }).where('id', '=', id),
    ...projection.statements,
  ], identity)
  return affected ?? 0
}

export function archiveDocument(id: string): Promise<number> {
  return archiveRecord('documents', id)
}
