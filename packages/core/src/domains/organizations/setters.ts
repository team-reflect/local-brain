import type { Organizations } from '@local-brain/db'
import { db, dbForDatabase } from '../../db/client'
import { batch } from '../../db/commands'
import { activeDatabaseIdentity, type DatabaseIdentity } from '../../db/identity'
import {
  archiveRecord,
  insertRecord,
  updateRecord,
  type NewRecord,
  type RecordPatch,
} from '../../db/records'
import { nowIso } from '../../db/time'
import { contentChunkProjection } from '../../ingest/content-projection'
import {
  ORGANIZATION_PROFILE_COLUMNS,
  organizationProfileText,
} from '../../ingest/entity-profile'
import { validateNewOrganization, validateOrganizationPatch } from './validators'

export type NewOrganization = NewRecord<Organizations>
export type OrganizationPatch = RecordPatch<Organizations>

/** Create an organization and return its id, optionally pinned to a captured brain. */
export function createOrganization(
  input: NewOrganization,
  expectedIdentity?: DatabaseIdentity,
): Promise<string> {
  return insertRecord('organizations', validateNewOrganization(input), expectedIdentity)
}

/**
 * Update an organization; profile-field patches refresh search chunks atomically.
 * A supplied identity rejects stale work after a brain switch.
 */
export function updateOrganization(
  id: string,
  patch: OrganizationPatch,
  expectedIdentity?: DatabaseIdentity,
): Promise<number> {
  const clean = validateOrganizationPatch(patch)
  const changesProfile = ORGANIZATION_PROFILE_COLUMNS.some(
    (column) => clean[column] !== undefined,
  )
  if (!changesProfile) return updateRecord('organizations', id, clean, expectedIdentity)

  return updateOrganizationProfile(id, clean, expectedIdentity)
}

async function updateOrganizationProfile(
  id: string,
  patch: OrganizationPatch,
  expectedIdentity?: DatabaseIdentity,
): Promise<number> {
  const identity = expectedIdentity ?? (await activeDatabaseIdentity())
  const existing = await dbForDatabase(identity)
    .selectFrom('organizations')
    .select(ORGANIZATION_PROFILE_COLUMNS)
    .where('id', '=', id)
    .executeTakeFirst()
  if (!existing) return updateRecord('organizations', id, patch, identity)

  const projection = await contentChunkProjection(
    'organization',
    id,
    organizationProfileText(existing, patch),
    { databaseIdentity: identity },
  )
  const [affected] = await batch([
    db
      .updateTable('organizations')
      .set({ ...patch, updatedAt: nowIso() })
      .where('id', '=', id),
    ...projection.statements,
  ], identity)
  return affected ?? 0
}

/** Soft-delete: archive rather than remove, so links and history survive. */
export function archiveOrganization(id: string): Promise<number> {
  return archiveRecord('organizations', id)
}
