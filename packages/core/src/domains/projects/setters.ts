import type { Projects } from '@local-brain/db'
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
import { validateNewProject, validateProjectPatch } from './validators'
import type { DatabaseIdentity } from '../../db/identity'

export type NewProject = NewRecord<Projects>
export type ProjectPatch = RecordPatch<Projects>

/** Create a project, optionally rejecting the write after a brain switch. */
export function createProject(input: NewProject, expectedIdentity?: DatabaseIdentity): Promise<string> {
  return insertRecord('projects', validateNewProject(input), expectedIdentity)
}

/** Update a project, optionally pinned to a captured brain identity. */
export function updateProject(
  id: string,
  patch: ProjectPatch,
  expectedIdentity?: DatabaseIdentity,
): Promise<number> {
  return updateRecord('projects', id, validateProjectPatch(patch), expectedIdentity)
}

/** Mark a project completed (status + completion date). */
export function completeProject(id: string, completedOn = nowIso()): Promise<number> {
  return execute(
    db
      .updateTable('projects')
      .set({ status: 'completed', completedOn, updatedAt: nowIso() })
      .where('id', '=', id),
  )
}

export function archiveProject(id: string): Promise<number> {
  return archiveRecord('projects', id)
}
