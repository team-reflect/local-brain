import type { Selectable } from 'kysely'
import type { People } from '@local-brain/db'
import { db } from '../../db/client'

export type Person = Selectable<People> & {
  relationshipStrength: number | null
}

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
    .selectAll('people')
    .select('relationshipStrengths.relationshipStrength')
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
    .selectAll('people')
    .select('relationshipStrengths.relationshipStrength')
    .where('people.id', '=', id)
    .executeTakeFirst()
}

/** The user's own profile (the `is_self = 1` row), if one exists. */
export function getSelf(): Promise<Person | undefined> {
  return db
    .selectFrom('people')
    .leftJoin('relationshipStrengths', 'relationshipStrengths.personId', 'people.id')
    .selectAll('people')
    .select('relationshipStrengths.relationshipStrength')
    .where('people.isSelf', '=', 1)
    .executeTakeFirst()
}
