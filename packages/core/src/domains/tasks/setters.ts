import type { Insertable, Updateable } from 'kysely'
import type { Tasks } from '@local-brain/db'
import { db } from '../../db/client'
import { execute } from '../../db/commands'
import { newId } from '../../db/id'
import { nowIso } from '../../db/time'

export type NewTask = Omit<Insertable<Tasks>, 'id' | 'createdAt' | 'updatedAt'>
export type TaskPatch = Omit<Updateable<Tasks>, 'id' | 'createdAt'>

export async function createTask(input: NewTask): Promise<string> {
  const id = newId()
  await execute(db.insertInto('tasks').values({ ...input, id }))
  return id
}

export function updateTask(id: string, patch: TaskPatch): Promise<number> {
  return execute(
    db
      .updateTable('tasks')
      .set({ ...patch, updatedAt: nowIso() })
      .where('id', '=', id),
  )
}

/** Mark a task done (status + completion timestamp). */
export function completeTask(id: string, completedAt = nowIso()): Promise<number> {
  return execute(
    db
      .updateTable('tasks')
      .set({ status: 'done', completedAt, updatedAt: nowIso() })
      .where('id', '=', id),
  )
}

export function archiveTask(id: string): Promise<number> {
  return execute(
    db
      .updateTable('tasks')
      .set({ archivedAt: nowIso(), updatedAt: nowIso() })
      .where('id', '=', id),
  )
}
