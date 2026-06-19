import type { Selectable } from 'kysely'
import type { Projects } from '@local-brain/db'
import { db } from '../../db/client'

export type Project = Selectable<Projects>

export interface ListProjectsOptions {
  status?: string
  includeArchived?: boolean
  /** Exclude projects with a non-null completedOn date (default false). */
  activeOnly?: boolean
  limit?: number
}

/** Projects, newest first, optionally filtered by status. */
export function listProjects(options: ListProjectsOptions = {}): Promise<Project[]> {
  let query = db.selectFrom('projects').selectAll()
  if (!options.includeArchived) {
    query = query.where('archivedAt', 'is', null)
  }
  if (options.activeOnly) {
    query = query.where('completedOn', 'is', null)
  }
  if (options.status !== undefined) {
    query = query.where('status', '=', options.status)
  }
  query = query.orderBy('createdAt', 'desc')
  if (options.limit !== undefined) {
    query = query.limit(options.limit)
  }
  return query.execute()
}

export function getProject(id: string): Promise<Project | undefined> {
  return db.selectFrom('projects').selectAll().where('id', '=', id).executeTakeFirst()
}
