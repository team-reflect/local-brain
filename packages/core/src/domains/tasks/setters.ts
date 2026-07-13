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
import type { DatabaseIdentity } from '../../db/identity'

export type NewTask = NewRecord<Tasks>
export type TaskPatch = RecordPatch<Tasks>

/** Create a task, optionally rejecting the write after a brain switch. */
export function createTask(input: NewTask, expectedIdentity?: DatabaseIdentity): Promise<string> {
  return insertRecord('tasks', validateNewTask(input), expectedIdentity)
}

/** Update a task, optionally pinned to a captured brain identity. */
export function updateTask(
  id: string,
  patch: TaskPatch,
  expectedIdentity?: DatabaseIdentity,
): Promise<number> {
  return updateRecord('tasks', id, validateTaskPatch(patch), expectedIdentity)
}

/** Mark a task done, optionally pinned to a captured brain identity. */
export function completeTask(
  id: string,
  completedAt = nowIso(),
  expectedIdentity?: DatabaseIdentity,
): Promise<number> {
  return setTaskCompleted(id, true, completedAt, expectedIdentity)
}

/**
 * Set or clear task completion, optionally pinned to a captured brain identity.
 * Clearing completion deterministically reopens the task and removes its completion timestamp.
 */
export function setTaskCompleted(
  id: string,
  completed: boolean,
  completedAt = nowIso(),
  expectedIdentity?: DatabaseIdentity,
): Promise<number> {
  return execute(
    db
      .updateTable('tasks')
      .set({
        status: completed ? 'done' : 'open',
        completedAt: completed ? completedAt : null,
        updatedAt: nowIso(),
      })
      .where('id', '=', id),
    expectedIdentity,
  )
}

export function archiveTask(id: string): Promise<number> {
  return archiveRecord('tasks', id)
}
