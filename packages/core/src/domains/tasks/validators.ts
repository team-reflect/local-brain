import { squish, trimToNull } from '../../text/normalize'
import { requireText, ValidationError } from '../../validation'
import { isTaskStatus, TASK_STATUSES, type TaskStatus } from './lifecycle'
import type { NewTask, TaskPatch } from './setters'

function validateStatus(value: string): TaskStatus {
  const status = value.trim().toLowerCase()
  if (!isTaskStatus(status)) {
    throw new ValidationError(`status must be one of: ${TASK_STATUSES.join(', ')}`)
  }
  return status
}

/** Normalize and validate a task write: `title` is required (non-blank). */
export function validateNewTask(input: NewTask): NewTask {
  const out: NewTask = { ...input }
  out.title = squish(requireText('title', input.title))
  if (input.description !== undefined) out.description = trimToNull(input.description)
  if (input.status !== undefined) out.status = validateStatus(input.status)
  return out
}

export function validateTaskPatch(patch: TaskPatch): TaskPatch {
  const out: TaskPatch = { ...patch }
  if (patch.title !== undefined) out.title = squish(requireText('title', patch.title))
  if (patch.description !== undefined) out.description = trimToNull(patch.description)
  if (patch.status !== undefined) out.status = validateStatus(patch.status)
  return out
}
