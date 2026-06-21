import type { Selectable } from 'kysely'
import type { Affiliations, People, PersonEmails, PersonPhones } from '@local-brain/db'
import { db } from '../../db/client'

export type Person = Selectable<People> & {
  relationshipStrength: number | null
}
export type PersonEmail = Selectable<PersonEmails>
export type PersonPhone = Selectable<PersonPhones>
export type PersonAffiliation = Selectable<Affiliations> & {
  organizationName: string | null
}

const PERSON_SELECT = [
  'people.id as id',
  'people.fullName as fullName',
  'people.preferredName as preferredName',
  'people.headline as headline',
  'people.summary as summary',
  'people.primaryEmail as primaryEmail',
  'people.primaryPhone as primaryPhone',
  'people.location as location',
  'people.city as city',
  'people.region as region',
  'people.country as country',
  'people.timezone as timezone',
  'people.linkedinUrl as linkedinUrl',
  'people.website as website',
  'people.isSelf as isSelf',
  'relationshipStrengths.lastInteractionAt as lastInteractionAt',
  'people.importantDatesJson as importantDatesJson',
  'people.notes as notes',
  'people.currentOrganizationId as currentOrganizationId',
  'people.currentTitle as currentTitle',
  'people.currentDepartment as currentDepartment',
  'people.roleFamily as roleFamily',
  'people.seniority as seniority',
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

/** Person-organization history, current/primary roles first. */
export function listPersonAffiliations(personId: string): Promise<PersonAffiliation[]> {
  return db
    .selectFrom('affiliations')
    .leftJoin('organizations', 'organizations.id', 'affiliations.organizationId')
    .selectAll('affiliations')
    .select('organizations.name as organizationName')
    .where('affiliations.personId', '=', personId)
    .orderBy('affiliations.isCurrent', 'desc')
    .orderBy('affiliations.isPrimary', 'desc')
    .orderBy('affiliations.startedOn', 'desc')
    .orderBy('organizations.name', 'asc')
    .execute()
}
