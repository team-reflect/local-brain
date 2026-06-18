import type { Tasks } from '@local-brain/db'
import { db } from '../../db/client'
import { execute } from '../../db/commands'
import { newId } from '../../db/id'
import type { NewRecord, RecordPatch } from '../../db/records'
import { nowIso } from '../../db/time'

export type NewTask = NewRecord<Tasks>
export type TaskPatch = RecordPatch<Tasks>

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
