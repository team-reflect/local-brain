import type { Database } from '@local-brain/db'
import { contentChunkProjection } from '../ingest/content-projection'
import { ValidationError } from '../validation'
import { db, dbForDatabase } from './client'
import { batch } from './commands'
import { activeDatabaseIdentity, type DatabaseIdentity } from './identity'
import { updateRecord, type RecordPatch } from './records'
import { nowIso } from './time'

type ContentTable = 'documents' | 'interactions'

const CONTENT_TYPES = { documents: 'document', interactions: 'interaction' } as const

/**
 * Apply a normalized content patch in one captured brain. Clearing content must
 * leave a title or body; body edits also rebuild search chunks in the same
 * transaction. Metadata-only edits never rewrite the body projection.
 */
export async function updateContentRecord(
  table: ContentTable,
  id: string,
  patch: RecordPatch<Database[ContentTable]>,
  expectedIdentity?: DatabaseIdentity,
): Promise<number> {
  const identity = expectedIdentity ?? (await activeDatabaseIdentity())
  const changesBody = patch.bodyText !== undefined
  const clearsContent = (patch.title === null || patch.bodyText === null)
    && !patch.title && !patch.bodyText
  if (!changesBody && !clearsContent) return updateRecord(table, id, patch, identity)

  const existing = await dbForDatabase(identity)
    .selectFrom(table)
    .select(['title', 'bodyText'])
    .where('id', '=', id)
    .executeTakeFirst()
  if (!existing) return updateRecord(table, id, patch, identity)

  const title = patch.title === undefined ? existing.title : patch.title
  const body = changesBody ? patch.bodyText : existing.bodyText
  if (!title && !body) {
    const label = table === 'documents' ? 'a document' : 'an interaction'
    throw new ValidationError(`${label} needs a title or body text`)
  }
  if (!changesBody) return updateRecord(table, id, patch, identity)

  const projection = await contentChunkProjection(CONTENT_TYPES[table], id, body, {
    databaseIdentity: identity,
  })
  const [affected] = await batch([
    db.updateTable(table).set({ ...patch, updatedAt: nowIso() }).where('id', '=', id),
    ...projection.statements,
  ], identity)
  return affected ?? 0
}
