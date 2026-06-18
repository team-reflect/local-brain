import type { Organizations } from '@local-brain/db'
import { db } from '../../db/client'
import { execute } from '../../db/commands'
import { newId } from '../../db/id'
import type { NewRecord, RecordPatch } from '../../db/records'
import { nowIso } from '../../db/time'

export type NewOrganization = NewRecord<Organizations>
export type OrganizationPatch = RecordPatch<Organizations>

/** Create an organization and return its generated id. */
export async function createOrganization(input: NewOrganization): Promise<string> {
  const id = newId()
  await execute(db.insertInto('organizations').values({ ...input, id }))
  return id
}

export function updateOrganization(id: string, patch: OrganizationPatch): Promise<number> {
  return execute(
    db
      .updateTable('organizations')
      .set({ ...patch, updatedAt: nowIso() })
      .where('id', '=', id),
  )
}

/** Soft-delete: archive rather than remove, so links and history survive. */
export function archiveOrganization(id: string): Promise<number> {
  return execute(
    db
      .updateTable('organizations')
      .set({ archivedAt: nowIso(), updatedAt: nowIso() })
      .where('id', '=', id),
  )
}
