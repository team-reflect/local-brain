import type { Projects } from '@local-brain/db'
import { db } from '../../db/client'
import { execute } from '../../db/commands'
import { newId } from '../../db/id'
import type { NewRecord, RecordPatch } from '../../db/records'
import { nowIso } from '../../db/time'

export type NewProject = NewRecord<Projects>
export type ProjectPatch = RecordPatch<Projects>

export async function createProject(input: NewProject): Promise<string> {
  const id = newId()
  await execute(db.insertInto('projects').values({ ...input, id }))
  return id
}

export function updateProject(id: string, patch: ProjectPatch): Promise<number> {
  return execute(
    db
      .updateTable('projects')
      .set({ ...patch, updatedAt: nowIso() })
      .where('id', '=', id),
  )
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
  return execute(
    db
      .updateTable('projects')
      .set({ archivedAt: nowIso(), updatedAt: nowIso() })
      .where('id', '=', id),
  )
}
