import type { Insertable, Updateable } from 'kysely'
import type { Organizations } from '@local-brain/db'
import { db } from '../../db/client'
import { execute } from '../../db/commands'
import { newId } from '../../db/id'
import { nowIso } from '../../db/time'

export type NewOrganization = Omit<Insertable<Organizations>, 'id' | 'createdAt' | 'updatedAt'>
export type OrganizationPatch = Omit<Updateable<Organizations>, 'id' | 'createdAt'>

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
