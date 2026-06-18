import type { Compilable } from 'kysely'
import { db } from '../../db/client'
import { execute } from '../../db/commands'
import { nowIso } from '../../db/time'

/**
 * Correction setter for typed record links (Plan 05 step 8 — "unlink wrong
 * person/org/project/task"). Extraction and ingestion connect records through the
 * typed join tables; from any detail page the user can sever one wrong link.
 *
 * Links are *undirected* here: `unlinkRecords(person, project)` and
 * `unlinkRecords(project, person)` resolve to the same join table. Each pair maps
 * to a single delete (or, for the project↔task relation that lives on
 * `tasks.project_id`, a single clearing update), so the write is inherently
 * atomic. Memory links are corrected separately (see memories/setters).
 */

/** Record kinds that participate in the typed join tables. */
export type LinkableKind =
  | 'person'
  | 'organization'
  | 'project'
  | 'task'
  | 'document'
  | 'interaction'

export interface LinkRef {
  kind: LinkableKind
  id: string
}

type IdFor = (kind: LinkableKind) => string
type Unlinker = (id: IdFor) => Compilable

/**
 * One unlinker per relation, keyed by the two kinds sorted alphabetically so
 * lookup is order-independent. Covers every relation surfaced on the detail
 * pages' linked-record sections.
 */
const UNLINKERS: Record<string, Unlinker> = {
  'organization|person': (id) =>
    db
      .deleteFrom('affiliations')
      .where('personId', '=', id('person'))
      .where('organizationId', '=', id('organization')),
  'person|project': (id) =>
    db
      .deleteFrom('projectPeople')
      .where('personId', '=', id('person'))
      .where('projectId', '=', id('project')),
  'person|task': (id) =>
    db.deleteFrom('taskPeople').where('personId', '=', id('person')).where('taskId', '=', id('task')),
  'interaction|person': (id) =>
    db
      .deleteFrom('interactionParticipants')
      .where('personId', '=', id('person'))
      .where('interactionId', '=', id('interaction')),
  'document|person': (id) =>
    db
      .deleteFrom('documentPeople')
      .where('personId', '=', id('person'))
      .where('documentId', '=', id('document')),
  'organization|project': (id) =>
    db
      .deleteFrom('projectOrganizations')
      .where('organizationId', '=', id('organization'))
      .where('projectId', '=', id('project')),
  'document|organization': (id) =>
    db
      .deleteFrom('documentOrganizations')
      .where('organizationId', '=', id('organization'))
      .where('documentId', '=', id('document')),
  'interaction|organization': (id) =>
    db
      .deleteFrom('interactionOrganizations')
      .where('organizationId', '=', id('organization'))
      .where('interactionId', '=', id('interaction')),
  'organization|task': (id) =>
    db
      .deleteFrom('taskOrganizations')
      .where('organizationId', '=', id('organization'))
      .where('taskId', '=', id('task')),
  // The project↔task relation lives on tasks.project_id, not a join table.
  'project|task': (id) =>
    db
      .updateTable('tasks')
      .set({ projectId: null, updatedAt: nowIso() })
      .where('id', '=', id('task'))
      .where('projectId', '=', id('project')),
  'document|project': (id) =>
    db
      .deleteFrom('projectDocuments')
      .where('projectId', '=', id('project'))
      .where('documentId', '=', id('document')),
  'interaction|project': (id) =>
    db
      .deleteFrom('projectInteractions')
      .where('projectId', '=', id('project'))
      .where('interactionId', '=', id('interaction')),
  'document|task': (id) =>
    db
      .deleteFrom('taskDocuments')
      .where('taskId', '=', id('task'))
      .where('documentId', '=', id('document')),
  'interaction|task': (id) =>
    db
      .deleteFrom('taskInteractions')
      .where('taskId', '=', id('task'))
      .where('interactionId', '=', id('interaction')),
  'document|interaction': (id) =>
    db
      .deleteFrom('documentInteractions')
      .where('documentId', '=', id('document'))
      .where('interactionId', '=', id('interaction')),
}

function relationKey(a: LinkableKind, b: LinkableKind): string {
  return [a, b].sort().join('|')
}

/**
 * Sever the link between two records, whichever order they are given. Throws if
 * the two kinds have no typed relation. Resolves to the number of rows removed
 * (0 if they were not actually linked).
 */
export function unlinkRecords(a: LinkRef, b: LinkRef): Promise<number> {
  const unlinker = UNLINKERS[relationKey(a.kind, b.kind)]
  if (!unlinker) {
    throw new Error(`no typed link between ${a.kind} and ${b.kind}`)
  }
  const idByKind: Partial<Record<LinkableKind, string>> = { [a.kind]: a.id, [b.kind]: b.id }
  return execute(
    unlinker((kind) => {
      const id = idByKind[kind]
      if (id === undefined) throw new Error(`missing ${kind} id for unlink`)
      return id
    }),
  )
}
