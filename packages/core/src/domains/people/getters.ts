import type { Selectable } from 'kysely'
import type { People, PersonEmails, PersonPhones } from '@local-brain/db'
import { db } from '../../db/client'

export type Person = Selectable<People> & {
  relationshipStrength: number | null
}
export type PersonEmail = Selectable<PersonEmails>
export type PersonPhone = Selectable<PersonPhones>

const PERSON_SELECT = [
  'people.id as id',
  'people.fullName as fullName',
  'people.preferredName as preferredName',
  'people.headline as headline',
  'people.primaryEmail as primaryEmail',
  'people.primaryPhone as primaryPhone',
  'people.location as location',
  'people.isSelf as isSelf',
  'people.reconnectIntervalDays as reconnectIntervalDays',
  'relationshipStrengths.lastInteractionAt as lastInteractionAt',
  'relationshipStrengths.nextReconnectAt as nextReconnectAt',
  'people.importantDatesJson as importantDatesJson',
  'people.summary as summary',
  'people.notes as notes',
  'people.currentOrganizationId as currentOrganizationId',
  'people.createdAt as createdAt',
  'people.updatedAt as updatedAt',
  'people.archivedAt as archivedAt',
  'relationshipStrengths.relationshipStrength as relationshipStrength',
] as const

export interface ListPeopleOptions {
  /** Include archived people (default: false). */
  includeArchived?: boolean
  limit?: number
}

/** People ordered by name. Hides archived rows unless asked. */
export function listPeople(options: ListPeopleOptions = {}): Promise<Person[]> {
  let query = db
    .selectFrom('people')
    .leftJoin('relationshipStrengths', 'relationshipStrengths.personId', 'people.id')
    .select(PERSON_SELECT)
  if (!options.includeArchived) {
    query = query.where('people.archivedAt', 'is', null)
  }
  query = query.orderBy('people.fullName', 'asc')
  if (options.limit !== undefined) {
    query = query.limit(options.limit)
  }
  return query.execute()
}

export function getPerson(id: string): Promise<Person | undefined> {
  return db
    .selectFrom('people')
    .leftJoin('relationshipStrengths', 'relationshipStrengths.personId', 'people.id')
    .select(PERSON_SELECT)
    .where('people.id', '=', id)
    .executeTakeFirst()
}

/** The user's own profile (the `is_self = 1` row), if one exists. */
export function getSelf(): Promise<Person | undefined> {
  return db
    .selectFrom('people')
    .leftJoin('relationshipStrengths', 'relationshipStrengths.personId', 'people.id')
    .select(PERSON_SELECT)
    .where('people.isSelf', '=', 1)
    .executeTakeFirst()
}

export function listPersonEmails(personId: string): Promise<PersonEmail[]> {
  return db
    .selectFrom('personEmails')
    .selectAll()
    .where('personId', '=', personId)
    .orderBy('isPrimary', 'desc')
    .orderBy('email', 'asc')
    .execute()
}

export function listPersonPhones(personId: string): Promise<PersonPhone[]> {
  return db
    .selectFrom('personPhones')
    .selectAll()
    .where('personId', '=', personId)
    .orderBy('isPrimary', 'desc')
    .orderBy('phone', 'asc')
    .execute()
}
