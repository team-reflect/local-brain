import type { Selectable } from 'kysely'
import type { Tasks } from '@local-brain/db'
import { db } from '../../db/client'

export type Task = Selectable<Tasks>

export interface ListTasksOptions {
  status?: string
  projectId?: string
  includeArchived?: boolean
  limit?: number
}

/** Tasks ordered by due date (nulls last), optionally scoped by status/project. */
export function listTasks(options: ListTasksOptions = {}): Promise<Task[]> {
  let query = db.selectFrom('tasks').selectAll()
  if (!options.includeArchived) {
    query = query.where('archivedAt', 'is', null)
  }
  if (options.status !== undefined) {
    query = query.where('status', '=', options.status)
  }
  if (options.projectId !== undefined) {
    query = query.where('projectId', '=', options.projectId)
  }
  query = query.orderBy('dueAt', 'asc')
  if (options.limit !== undefined) {
    query = query.limit(options.limit)
  }
  return query.execute()
}

export function getTask(id: string): Promise<Task | undefined> {
  return db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirst()
}
