import type { People } from '@local-brain/db'
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
import { PERSON_PROFILE_COLUMNS, personProfileText } from '../../ingest/entity-profile'
import { validateNewPerson, validatePersonPatch } from './validators'

export type NewPerson = NewRecord<People>
export type PersonPatch = RecordPatch<People>

/** Create a person and return its id, optionally pinned to a captured brain. */
export function createPerson(input: NewPerson, expectedIdentity?: DatabaseIdentity): Promise<string> {
  return insertRecord('people', validateNewPerson(input), expectedIdentity)
}

/**
 * Update a person; profile-field patches refresh its search chunks atomically.
 * A supplied identity rejects stale work after a brain switch.
 */
export function updatePerson(
  id: string,
  patch: PersonPatch,
  expectedIdentity?: DatabaseIdentity,
): Promise<number> {
  const clean = validatePersonPatch(patch)
  const changesProfile = PERSON_PROFILE_COLUMNS.some((column) => clean[column] !== undefined)
  if (!changesProfile) return updateRecord('people', id, clean, expectedIdentity)

  return updatePersonProfile(id, clean, expectedIdentity)
}

async function updatePersonProfile(
  id: string,
  patch: PersonPatch,
  expectedIdentity?: DatabaseIdentity,
): Promise<number> {
  const identity = expectedIdentity ?? (await activeDatabaseIdentity())
  const existing = await dbForDatabase(identity)
    .selectFrom('people')
    .select(PERSON_PROFILE_COLUMNS)
    .where('id', '=', id)
    .executeTakeFirst()
  if (!existing) return updateRecord('people', id, patch, identity)

  const projection = await contentChunkProjection(
    'person',
    id,
    personProfileText(existing, patch),
    { databaseIdentity: identity },
  )
  const [affected] = await batch([
    db
      .updateTable('people')
      .set({ ...patch, updatedAt: nowIso() })
      .where('id', '=', id),
    ...projection.statements,
  ], identity)
  return affected ?? 0
}

/** Soft-delete: archive rather than remove, so links and history survive. */
export function archivePerson(id: string): Promise<number> {
  return archiveRecord('people', id)
}
