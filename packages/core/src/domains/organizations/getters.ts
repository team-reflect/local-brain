import type { Selectable } from 'kysely'
import type { OrganizationProfiles, Organizations } from '@local-brain/db'
import { db } from '../../db/client'

export type Organization = Selectable<Organizations>
export type OrganizationProfile = Selectable<OrganizationProfiles>

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

/** AI/research enrichment profiles for an organization, newest research first. */
export function listOrganizationProfiles(organizationId: string): Promise<OrganizationProfile[]> {
  return db
    .selectFrom('organizationProfiles')
    .selectAll()
    .where('organizationId', '=', organizationId)
    .orderBy('researchedAt', 'desc')
    .orderBy('createdAt', 'desc')
    .execute()
}
