import type { Selectable } from 'kysely'
import type { Organizations } from '@local-brain/db'
import { db } from '../../db/client'

export type Organization = Selectable<Organizations>

export interface ListOrganizationsOptions {
  /** Include archived organizations (default: false). */
  includeArchived?: boolean
  limit?: number
}

/** Organizations ordered by name. Hides archived rows unless asked. */
export function listOrganizations(options: ListOrganizationsOptions = {}): Promise<Organization[]> {
  let query = db.selectFrom('organizations').selectAll()
  if (!options.includeArchived) {
    query = query.where('archivedAt', 'is', null)
  }
  query = query.orderBy('name', 'asc')
  if (options.limit !== undefined) {
    query = query.limit(options.limit)
  }
  return query.execute()
}

export function getOrganization(id: string): Promise<Organization | undefined> {
  return db.selectFrom('organizations').selectAll().where('id', '=', id).executeTakeFirst()
}
