import type { Tasks } from '@local-brain/db'
import { db } from '../../db/client'
import { execute } from '../../db/commands'
import {
  archiveRecord,
  insertRecord,
  updateRecord,
  type NewRecord,
  type RecordPatch,
} from '../../db/records'
import { nowIso } from '../../db/time'
import { validateNewTask, validateTaskPatch } from './validators'

export type NewTask = NewRecord<Tasks>
export type TaskPatch = RecordPatch<Tasks>

export function createTask(input: NewTask): Promise<string> {
  return insertRecord('tasks', validateNewTask(input))
}

export function updateTask(id: string, patch: TaskPatch): Promise<number> {
  return updateRecord('tasks', id, validateTaskPatch(patch))
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
  return archiveRecord('tasks', id)
}
