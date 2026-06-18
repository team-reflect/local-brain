import type { Compilable } from 'kysely'
import { db } from '../db/client'
import { newId } from '../db/id'
import type { SourceRecordType } from './preprocess'

/**
 * The one place that knows how a source record (a `document` or an
 * `interaction`) links to a typed entity (person / organization / project /
 * task). Both ingestion (user-picked links) and extraction (model-resolved
 * entities) write these join rows, and the apply merge reads back the existing
 * ones to avoid duplicate pairs — so the table topology is defined exactly once
 * here, as typed insert/select closures, instead of being re-spelled in each
 * caller.
 */

/** The typed entities a source record can be linked to. */
export type LinkEntityType = 'person' | 'organization' | 'project' | 'task'

export const LINK_ENTITY_TYPES: readonly LinkEntityType[] = [
  'person',
  'organization',
  'project',
  'task',
]

/** Entity ids already linked to a source record, grouped by entity type. */
export type SourceLinks = Record<LinkEntityType, Set<string>>

/** The source record an apply/ingest is attaching entities to. */
export interface LinkSource {
  recordType: SourceRecordType
  recordId: string
}

interface LinkBinding {
  /** Build the join-row insert linking `entityId` to source `recordId`. */
  insert: (recordId: string, entityId: string) => Compilable
  /** The ids already linked to source `recordId`. */
  loadLinked: (recordId: string) => Promise<string[]>
}

/**
 * `[source record type][entity type] → binding`. Each closure names a literal
 * table, so Kysely fully type-checks the column orientation (which side of the
 * join holds the source id vs. the entity id).
 */
const BINDINGS: Record<SourceRecordType, Record<LinkEntityType, LinkBinding>> = {
  document: {
    person: {
      insert: (documentId, personId) =>
        db.insertInto('documentPeople').values({ id: newId(), documentId, personId }),
      loadLinked: (documentId) =>
        db
          .selectFrom('documentPeople')
          .select('personId')
          .where('documentId', '=', documentId)
          .execute()
          .then((rows) => rows.map((r) => r.personId)),
    },
    organization: {
      insert: (documentId, organizationId) =>
        db.insertInto('documentOrganizations').values({ id: newId(), documentId, organizationId }),
      loadLinked: (documentId) =>
        db
          .selectFrom('documentOrganizations')
          .select('organizationId')
          .where('documentId', '=', documentId)
          .execute()
          .then((rows) => rows.map((r) => r.organizationId)),
    },
    project: {
      insert: (documentId, projectId) =>
        db.insertInto('projectDocuments').values({ id: newId(), projectId, documentId }),
      loadLinked: (documentId) =>
        db
          .selectFrom('projectDocuments')
          .select('projectId')
          .where('documentId', '=', documentId)
          .execute()
          .then((rows) => rows.map((r) => r.projectId)),
    },
    task: {
      insert: (documentId, taskId) =>
        db.insertInto('taskDocuments').values({ id: newId(), taskId, documentId }),
      loadLinked: (documentId) =>
        db
          .selectFrom('taskDocuments')
          .select('taskId')
          .where('documentId', '=', documentId)
          .execute()
          .then((rows) => rows.map((r) => r.taskId)),
    },
  },
  interaction: {
    person: {
      insert: (interactionId, personId) =>
        db.insertInto('interactionParticipants').values({ id: newId(), interactionId, personId }),
      loadLinked: (interactionId) =>
        db
          .selectFrom('interactionParticipants')
          .select('personId')
          .where('interactionId', '=', interactionId)
          .execute()
          .then((rows) => rows.map((r) => r.personId)),
    },
    organization: {
      insert: (interactionId, organizationId) =>
        db
          .insertInto('interactionOrganizations')
          .values({ id: newId(), interactionId, organizationId }),
      loadLinked: (interactionId) =>
        db
          .selectFrom('interactionOrganizations')
          .select('organizationId')
          .where('interactionId', '=', interactionId)
          .execute()
          .then((rows) => rows.map((r) => r.organizationId)),
    },
    project: {
      insert: (interactionId, projectId) =>
        db.insertInto('projectInteractions').values({ id: newId(), projectId, interactionId }),
      loadLinked: (interactionId) =>
        db
          .selectFrom('projectInteractions')
          .select('projectId')
          .where('interactionId', '=', interactionId)
          .execute()
          .then((rows) => rows.map((r) => r.projectId)),
    },
    task: {
      insert: (interactionId, taskId) =>
        db.insertInto('taskInteractions').values({ id: newId(), taskId, interactionId }),
      loadLinked: (interactionId) =>
        db
          .selectFrom('taskInteractions')
          .select('taskId')
          .where('interactionId', '=', interactionId)
          .execute()
          .then((rows) => rows.map((r) => r.taskId)),
    },
  },
}

/** The insert linking one entity to a source record (no dedupe). */
export function sourceLinkInsert(
  recordType: SourceRecordType,
  recordId: string,
  entityType: LinkEntityType,
  entityId: string,
): Compilable {
  return BINDINGS[recordType][entityType].insert(recordId, entityId)
}

/** Load the ids already linked to the source record, so we never re-insert a pair. */
export async function loadSourceLinks(source: LinkSource): Promise<SourceLinks> {
  const [person, organization, project, task] = await Promise.all(
    LINK_ENTITY_TYPES.map((type) => BINDINGS[source.recordType][type].loadLinked(source.recordId)),
  )
  return {
    person: new Set(person),
    organization: new Set(organization),
    project: new Set(project),
    task: new Set(task),
  }
}

/**
 * Statement linking the given entity to the source record, or null if it is
 * already linked. Mutates `existing` so duplicates within one apply collapse too.
 */
export function sourceLinkStatement(
  source: LinkSource,
  entityType: LinkEntityType,
  entityId: string,
  existing: SourceLinks,
): Compilable | null {
  const linked = existing[entityType]
  if (linked.has(entityId)) return null
  linked.add(entityId)
  return sourceLinkInsert(source.recordType, source.recordId, entityType, entityId)
}
