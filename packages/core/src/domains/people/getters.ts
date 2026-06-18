import type { Selectable } from 'kysely'
import type { People } from '@local-brain/db'
import { db } from '../../db/client'

export type Person = Selectable<People>

export interface ListPeopleOptions {
  /** Include archived people (default: false). */
  includeArchived?: boolean
  limit?: number
}

/** People ordered by name. Hides archived rows unless asked. */
export function listPeople(options: ListPeopleOptions = {}): Promise<Person[]> {
  let query = db.selectFrom('people').selectAll()
  if (!options.includeArchived) {
    query = query.where('archivedAt', 'is', null)
  }
  query = query.orderBy('fullName', 'asc')
  if (options.limit !== undefined) {
    query = query.limit(options.limit)
  }
  return query.execute()
}

export function getPerson(id: string): Promise<Person | undefined> {
  return db.selectFrom('people').selectAll().where('id', '=', id).executeTakeFirst()
}

/** The user's own profile (the `is_self = 1` row), if one exists. */
export function getSelf(): Promise<Person | undefined> {
  return db.selectFrom('people').selectAll().where('isSelf', '=', 1).executeTakeFirst()
}
