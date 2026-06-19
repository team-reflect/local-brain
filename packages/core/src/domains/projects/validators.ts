import { squish, trimToNull } from '../../text/normalize'
import { requireText } from '../../validation'
import type { NewProject, ProjectPatch } from './setters'

/** Normalize and validate a project write: `name` is required (non-blank). */
export function validateNewProject(input: NewProject): NewProject {
  const out: NewProject = { ...input }
  out.name = squish(requireText('name', input.name))
  if (input.kind !== undefined) out.kind = trimToNull(input.kind)
  if (input.summary !== undefined) out.summary = trimToNull(input.summary)
  if (input.notes !== undefined) out.notes = trimToNull(input.notes)
  return out
}

export function validateProjectPatch(patch: ProjectPatch): ProjectPatch {
  const out: ProjectPatch = { ...patch }
  if (patch.name !== undefined) out.name = squish(requireText('name', patch.name))
  if (patch.kind !== undefined) out.kind = trimToNull(patch.kind)
  if (patch.summary !== undefined) out.summary = trimToNull(patch.summary)
  if (patch.notes !== undefined) out.notes = trimToNull(patch.notes)
  return out
}
