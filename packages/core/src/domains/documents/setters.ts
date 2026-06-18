import type { Insertable, Updateable } from 'kysely'
import type { Documents } from '@local-brain/db'
import { db } from '../../db/client'
import { execute } from '../../db/commands'
import { newId } from '../../db/id'
import { nowIso } from '../../db/time'

export type NewDocument = Omit<Insertable<Documents>, 'id' | 'createdAt' | 'updatedAt'>
export type DocumentPatch = Omit<Updateable<Documents>, 'id' | 'createdAt'>

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
