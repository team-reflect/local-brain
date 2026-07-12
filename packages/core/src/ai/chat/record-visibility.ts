import type { AiNotes } from '@local-brain/db'
import type { Selectable } from 'kysely'
import { getAssetDetail } from '../../domains/assets/getters'
import { getDocument } from '../../domains/documents/getters'
import { getInteraction } from '../../domains/interactions/getters'
import { getOrganization } from '../../domains/organizations/getters'
import { getPerson } from '../../domains/people/getters'
import { getProject } from '../../domains/projects/getters'
import { getTask } from '../../domains/tasks/getters'

type AiNote = Selectable<AiNotes>

export function isVisibleArchived(value: { archivedAt: string | null }): boolean {
  return value.archivedAt === null
}

/**
 * Whether an AI note's exactly-one parent/subject anchor is still visible.
 * Unknown subject namespaces (for example `daily_brief`) have no typed archive
 * lifecycle, so they preserve the note's existing visibility.
 */
export async function isAiNoteAnchorVisible(note: AiNote): Promise<boolean> {
  const hasSubject = note.subjectType !== null && note.subjectId !== null
  const anchorCount = Number(note.interactionId !== null) +
    Number(note.documentId !== null) +
    Number(hasSubject)
  if (anchorCount !== 1) return false

  if (note.interactionId !== null) {
    const interaction = await getInteraction(note.interactionId)
    return interaction !== undefined && isVisibleArchived(interaction)
  }
  if (note.documentId !== null) {
    const document = await getDocument(note.documentId)
    return document !== undefined && isVisibleArchived(document)
  }

  const subjectId = note.subjectId
  if (subjectId === null) return false
  switch (note.subjectType) {
    case 'person': {
      const person = await getPerson(subjectId)
      return person !== undefined && isVisibleArchived(person)
    }
    case 'organization': {
      const organization = await getOrganization(subjectId)
      return organization !== undefined && isVisibleArchived(organization)
    }
    case 'project': {
      const project = await getProject(subjectId)
      return project !== undefined && isVisibleArchived(project)
    }
    case 'task': {
      const task = await getTask(subjectId)
      return task !== undefined && isVisibleArchived(task)
    }
    case 'document': {
      const document = await getDocument(subjectId)
      return document !== undefined && isVisibleArchived(document)
    }
    case 'interaction': {
      const interaction = await getInteraction(subjectId)
      return interaction !== undefined && isVisibleArchived(interaction)
    }
    case 'asset':
      return (await getAssetDetail(subjectId)) !== undefined
    default:
      return true
  }
}
