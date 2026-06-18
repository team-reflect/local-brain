import type { Compilable } from 'kysely'
import { db } from '../db/client'
import { newId } from '../db/id'
import type { SourceRecordType } from './preprocess'

/**
 * Store-facing helpers for {@link applyExtraction}: the pre-apply reads it needs
 * to merge deterministically (existing source links, source chunks, prior
 * affiliations/tasks/memory claims) and the one statement builder that links a
 * resolved entity back to its source record. Kept separate from the apply
 * orchestration so each file stays focused and readable.
 */

export interface ApplySource {
  recordType: SourceRecordType
  recordId: string
}

export type EntityType = 'person' | 'organization' | 'project' | 'task'

export interface Resolved {
  type: EntityType
  id: string
}

export interface SourceLinks {
  people: Set<string>
  organizations: Set<string>
  projects: Set<string>
  tasks: Set<string>
}

/** Load the ids already linked to the source record, so we never re-insert a pair. */
export async function loadSourceLinks(source: ApplySource): Promise<SourceLinks> {
  if (source.recordType === 'document') {
    const [people, organizations, projects, tasks] = await Promise.all([
      db.selectFrom('documentPeople').select('personId').where('documentId', '=', source.recordId).execute(),
      db
        .selectFrom('documentOrganizations')
        .select('organizationId')
        .where('documentId', '=', source.recordId)
        .execute(),
      db.selectFrom('projectDocuments').select('projectId').where('documentId', '=', source.recordId).execute(),
      db.selectFrom('taskDocuments').select('taskId').where('documentId', '=', source.recordId).execute(),
    ])
    return {
      people: new Set(people.map((r) => r.personId)),
      organizations: new Set(organizations.map((r) => r.organizationId)),
      projects: new Set(projects.map((r) => r.projectId)),
      tasks: new Set(tasks.map((r) => r.taskId)),
    }
  }
  const [people, organizations, projects, tasks] = await Promise.all([
    db
      .selectFrom('interactionParticipants')
      .select('personId')
      .where('interactionId', '=', source.recordId)
      .execute(),
    db
      .selectFrom('interactionOrganizations')
      .select('organizationId')
      .where('interactionId', '=', source.recordId)
      .execute(),
    db
      .selectFrom('projectInteractions')
      .select('projectId')
      .where('interactionId', '=', source.recordId)
      .execute(),
    db.selectFrom('taskInteractions').select('taskId').where('interactionId', '=', source.recordId).execute(),
  ])
  return {
    people: new Set(people.map((r) => r.personId)),
    organizations: new Set(organizations.map((r) => r.organizationId)),
    projects: new Set(projects.map((r) => r.projectId)),
    tasks: new Set(tasks.map((r) => r.taskId)),
  }
}

/**
 * Statement linking the given entity to the source record, or null if it is
 * already linked. Mutates `existing` so duplicates within one apply collapse too.
 */
export function sourceLinkStatement(
  source: ApplySource,
  entity: Resolved,
  existing: SourceLinks,
): Compilable | null {
  const recordId = source.recordId
  if (entity.type === 'person') {
    if (existing.people.has(entity.id)) return null
    existing.people.add(entity.id)
    return source.recordType === 'document'
      ? db.insertInto('documentPeople').values({ id: newId(), documentId: recordId, personId: entity.id })
      : db
          .insertInto('interactionParticipants')
          .values({ id: newId(), interactionId: recordId, personId: entity.id })
  }
  if (entity.type === 'organization') {
    if (existing.organizations.has(entity.id)) return null
    existing.organizations.add(entity.id)
    return source.recordType === 'document'
      ? db
          .insertInto('documentOrganizations')
          .values({ id: newId(), documentId: recordId, organizationId: entity.id })
      : db
          .insertInto('interactionOrganizations')
          .values({ id: newId(), interactionId: recordId, organizationId: entity.id })
  }
  if (entity.type === 'project') {
    if (existing.projects.has(entity.id)) return null
    existing.projects.add(entity.id)
    return source.recordType === 'document'
      ? db.insertInto('projectDocuments').values({ id: newId(), projectId: entity.id, documentId: recordId })
      : db
          .insertInto('projectInteractions')
          .values({ id: newId(), projectId: entity.id, interactionId: recordId })
  }
  if (existing.tasks.has(entity.id)) return null
  existing.tasks.add(entity.id)
  return source.recordType === 'document'
    ? db.insertInto('taskDocuments').values({ id: newId(), taskId: entity.id, documentId: recordId })
    : db.insertInto('taskInteractions').values({ id: newId(), taskId: entity.id, interactionId: recordId })
}

/** Map a source record's chunk indexes to chunk ids, for resolving evidence refs. */
export async function loadChunkMap(source: ApplySource): Promise<Map<number, string>> {
  const rows = await db
    .selectFrom('contentChunks')
    .select(['chunkIndex', 'id'])
    .where('recordType', '=', source.recordType)
    .where('recordId', '=', source.recordId)
    .execute()
  return new Map(rows.map((row) => [row.chunkIndex, row.id]))
}

/** Existing `person:organization` affiliation pairs for the given people. */
export async function loadAffiliationPairs(personIds: readonly string[]): Promise<Set<string>> {
  if (personIds.length === 0) return new Set()
  const rows = await db
    .selectFrom('affiliations')
    .select(['personId', 'organizationId'])
    .where('personId', 'in', personIds)
    .execute()
  return new Set(rows.map((row) => `${row.personId}:${row.organizationId}`))
}

/** Non-archived tasks as `{id, title}` candidates for duplicate-title avoidance. */
export function loadTaskCandidates(): Promise<{ id: string; title: string }[]> {
  return db.selectFrom('tasks').where('archivedAt', 'is', null).select(['id', 'title']).execute()
}

/** Normalized claim text of every non-archived memory, for duplicate avoidance. */
export async function loadMemoryClaims(): Promise<Set<string>> {
  const rows = await db.selectFrom('memories').where('archivedAt', 'is', null).select('claim').execute()
  return new Set(rows.map((row) => row.claim.trim().toLowerCase()))
}
