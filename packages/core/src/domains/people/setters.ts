import type { People } from '@local-brain/db'
import { db } from '../../db/client'
import { execute } from '../../db/commands'
import { newId } from '../../db/id'
import type { NewRecord, RecordPatch } from '../../db/records'
import { nowIso } from '../../db/time'

export type NewPerson = NewRecord<People>
export type PersonPatch = RecordPatch<People>

/** Create a person and return its generated id. */
export async function createPerson(input: NewPerson): Promise<string> {
  const id = newId()
  await execute(db.insertInto('people').values({ ...input, id }))
  return id
}

export function updatePerson(id: string, patch: PersonPatch): Promise<number> {
  return execute(
    db
      .updateTable('people')
      .set({ ...patch, updatedAt: nowIso() })
      .where('id', '=', id),
  )
}

/** Soft-delete: archive rather than remove, so links and history survive. */
export function archivePerson(id: string): Promise<number> {
  return execute(
    db
      .updateTable('people')
      .set({ archivedAt: nowIso(), updatedAt: nowIso() })
      .where('id', '=', id),
  )
}
