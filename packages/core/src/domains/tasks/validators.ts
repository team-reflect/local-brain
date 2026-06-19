import { squish, trimToNull } from '../../text/normalize'
import { requireText } from '../../validation'
import type { NewTask, TaskPatch } from './setters'

/** Normalize and validate a task write: `title` is required (non-blank). */
export function validateNewTask(input: NewTask): NewTask {
  const out: NewTask = { ...input }
  out.title = squish(requireText('title', input.title))
  if (input.description !== undefined) out.description = trimToNull(input.description)
  return out
}

export function validateTaskPatch(patch: TaskPatch): TaskPatch {
  const out: TaskPatch = { ...patch }
  if (patch.title !== undefined) out.title = squish(requireText('title', patch.title))
  if (patch.description !== undefined) out.description = trimToNull(patch.description)
  return out
}
