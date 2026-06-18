import type { Documents } from '@local-brain/db'
import { db } from '../../db/client'
import { execute } from '../../db/commands'
import { newId } from '../../db/id'
import type { NewRecord, RecordPatch } from '../../db/records'
import { nowIso } from '../../db/time'

export type NewDocument = NewRecord<Documents>
export type DocumentPatch = RecordPatch<Documents>

export async function createDocument(input: NewDocument): Promise<string> {
  const id = newId()
  await execute(db.insertInto('documents').values({ ...input, id }))
  return id
}

export function updateDocument(id: string, patch: DocumentPatch): Promise<number> {
  return execute(
    db
      .updateTable('documents')
      .set({ ...patch, updatedAt: nowIso() })
      .where('id', '=', id),
  )
}

export function archiveDocument(id: string): Promise<number> {
  return execute(
    db
      .updateTable('documents')
      .set({ archivedAt: nowIso(), updatedAt: nowIso() })
      .where('id', '=', id),
  )
}
