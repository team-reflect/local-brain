import { db } from '../db/client'

/**
 * The user-centered knowledge graph. A read-only assembler that loads the
 * (non-archived) records and the typed join tables, then returns a node/edge
 * model centered on the user's own person row:
 *
 * - the self row is the hub; edges fan out to the people you know and the
 *   projects you own, so the map reads as "you, and everything around you";
 * - join-table edges (affiliations, project membership, project tasks, memory
 *   links) wire the rest of the network;
 * - interactions are not nodes. Each interaction is dissolved into weighted
 *   edges between the people it involved — a meeting links its attendees to one
 *   another, a 1:1 links you to that person — so the map reads as a relationship
 *   graph where edge thickness tracks how often you interact.
 *
 * The graph is intentionally uncapped: every visible graph node record is
 * returned. Layout and rendering performance belong in the graph surface, not in
 * the data contract.
 */

export type GraphNodeKind =
  | 'self'
  | 'person'
  | 'organization'
  | 'project'
  | 'task'
  | 'document'
  | 'memory'

export interface GraphNode {
  id: string
  kind: GraphNodeKind
  label: string
}

export type GraphEdgeKind =
  | 'knows'
  | 'owns'
  | 'affiliation'
  | 'member'
  | 'task'
  | 'memory'
  | 'interaction'

export interface GraphEdge {
  source: string
  target: string
  kind: GraphEdgeKind
  /** For `interaction` edges: how many interactions connect this pair. */
  weight?: number
  /** For `interaction` edges: the most recent interaction, for navigation. */
  interactionId?: string
}

export interface Graph {
  selfId: string | null
  nodes: GraphNode[]
  edges: GraphEdge[]
}

interface InteractionParticipantRef {
  interactionId: string
  personId: string | null
}

interface MemoryLinkRef {
  memoryId: string
  recordType: string
  recordId: string
}

function label(value: string | null, fallback: string): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return fallback
  return trimmed
}

/**
 * Reify interactions as weighted person-to-person edges. `interactions` must be
 * ordered most-recent-first; the array index doubles as a recency rank, so when
 * the same pair shares several interactions the latest one stays the edge's
 * representative (what the surface opens on click). Participants pointing at an
 * archived/absent interaction or at a person outside `personIds` are skipped; an
 * interaction with a single participant links them to `selfId`.
 */
function groupInteractionPeople(
  interactions: ReadonlyArray<{ id: string }>,
  participants: ReadonlyArray<InteractionParticipantRef>,
  personIds: ReadonlySet<string>,
): Map<string, Set<string>> {
  const activeInteractionIds = new Set(interactions.map((interaction) => interaction.id))
  const peopleByInteraction = new Map<string, Set<string>>()
  for (const row of participants) {
    if (row.personId === null) continue
    if (!activeInteractionIds.has(row.interactionId)) continue // archived or absent interaction
    if (!personIds.has(row.personId)) continue
    const group = peopleByInteraction.get(row.interactionId) ?? new Set<string>()
    group.add(row.personId)
    peopleByInteraction.set(row.interactionId, group)
  }
  return peopleByInteraction
}

export function deriveInteractionEdges(
  interactions: ReadonlyArray<{ id: string }>,
  participants: ReadonlyArray<InteractionParticipantRef>,
  personIds: ReadonlySet<string>,
  selfId: string | null,
): GraphEdge[] {
  const recencyRank = new Map<string, number>()
  interactions.forEach((interaction, index) => recencyRank.set(interaction.id, index))
  const peopleByInteraction = groupInteractionPeople(interactions, participants, personIds)

  const edges = new Map<string, Required<Pick<GraphEdge, 'source' | 'target' | 'weight' | 'interactionId'>>>()
  const link = (a: string, b: string, interactionId: string): void => {
    if (a === b) return
    const [source, target] = a < b ? [a, b] : [b, a]
    const key = `${source}\u0000${target}`
    const existing = edges.get(key)
    if (!existing) {
      edges.set(key, { source, target, weight: 1, interactionId })
      return
    }
    existing.weight += 1
    const incoming = recencyRank.get(interactionId) ?? Infinity
    const current = recencyRank.get(existing.interactionId) ?? Infinity
    if (incoming < current) existing.interactionId = interactionId
  }

  for (const [interactionId, group] of peopleByInteraction) {
    const people = [...group]
    if (people.length >= 2) {
      for (let i = 0; i < people.length; i += 1) {
        for (let j = i + 1; j < people.length; j += 1) {
          link(people[i]!, people[j]!, interactionId)
        }
      }
    } else if (people.length === 1 && selfId && people[0] !== selfId) {
      link(selfId, people[0]!, interactionId)
    }
  }

  return [...edges.values()].map((edge) => ({ ...edge, kind: 'interaction' }))
}

export function deriveMemoryEdges(
  memoryLinks: ReadonlyArray<MemoryLinkRef>,
  nodeIds: ReadonlySet<string>,
  peopleByInteraction: ReadonlyMap<string, ReadonlySet<string>>,
  activeInteractionIds: ReadonlySet<string>,
  selfId: string | null,
): GraphEdge[] {
  const seen = new Set<string>()
  const edges: GraphEdge[] = []
  const link = (memoryId: string, recordId: string): void => {
    if (!nodeIds.has(memoryId) || !nodeIds.has(recordId)) return
    const key = `${memoryId}\u0000${recordId}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ source: memoryId, target: recordId, kind: 'memory' })
  }

  for (const row of memoryLinks) {
    if (row.recordType === 'interaction') {
      const people = peopleByInteraction.get(row.recordId) ?? new Set<string>()
      if (people.size > 0) {
        for (const personId of people) link(row.memoryId, personId)
      } else if (selfId && activeInteractionIds.has(row.recordId)) {
        link(row.memoryId, selfId)
      }
    } else {
      link(row.memoryId, row.recordId)
    }
  }

  return edges
}

export async function getGraph(): Promise<Graph> {
  const [people, organizations, projects, tasks, documents, interactions, memories] =
    await Promise.all([
      db
        .selectFrom('people')
        .where('archivedAt', 'is', null)
        .orderBy('isSelf', 'desc')
        .orderBy('fullName', 'asc')
        .select(['id', 'fullName', 'isSelf'])
        .execute(),
      db
        .selectFrom('organizations')
        .where('archivedAt', 'is', null)
        .orderBy('name', 'asc')
        .select(['id', 'name'])
        .execute(),
      db
        .selectFrom('projects')
        .where('archivedAt', 'is', null)
        .orderBy('createdAt', 'desc')
        .select(['id', 'name'])
        .execute(),
      db
        .selectFrom('tasks')
        .where('archivedAt', 'is', null)
        .orderBy('createdAt', 'desc')
        .select(['id', 'title', 'projectId'])
        .execute(),
      db
        .selectFrom('documents')
        .where('archivedAt', 'is', null)
        .orderBy('createdAt', 'desc')
        .select(['id', 'title'])
        .execute(),
      // Ordered most-recent-first so derived edges keep the latest interaction
      // as their representative.
      db
        .selectFrom('interactions')
        .where('archivedAt', 'is', null)
        .orderBy('occurredAt', 'desc')
        .select(['id'])
        .execute(),
      db
        .selectFrom('memories')
        .where('archivedAt', 'is', null)
        .orderBy('createdAt', 'desc')
        .select(['id', 'claim'])
        .execute(),
    ])

  const selfRow = people.find((person) => person.isSelf === 1)
  const selfId = selfRow?.id ?? null

  const nodes: GraphNode[] = [
    ...people.map<GraphNode>((person) => ({
      id: person.id,
      kind: person.isSelf === 1 ? 'self' : 'person',
      label: label(person.fullName, 'Unnamed'),
    })),
    ...organizations.map<GraphNode>((org) => ({
      id: org.id,
      kind: 'organization',
      label: label(org.name, 'Organization'),
    })),
    ...projects.map<GraphNode>((project) => ({
      id: project.id,
      kind: 'project',
      label: label(project.name, 'Project'),
    })),
    ...tasks.map<GraphNode>((task) => ({
      id: task.id,
      kind: 'task',
      label: label(task.title, 'Task'),
    })),
    ...documents.map<GraphNode>((doc) => ({
      id: doc.id,
      kind: 'document',
      label: label(doc.title, 'Document'),
    })),
    ...memories.map<GraphNode>((memory) => ({
      id: memory.id,
      kind: 'memory',
      label: label(memory.claim, 'Memory'),
    })),
  ]
  const nodeIds = new Set(nodes.map((node) => node.id))
  const personIds = new Set(people.map((person) => person.id))

  // Only wire join-table edges whose endpoints are visible records.
  const inScope = (...ids: string[]): boolean => ids.every((id) => nodeIds.has(id))
  const projectIds = new Set(projects.map((project) => project.id))

  const [affiliations, projectPeople, participants, memoryLinks] = await Promise.all([
    db.selectFrom('affiliations').select(['personId', 'organizationId']).execute(),
    db.selectFrom('projectPeople').select(['projectId', 'personId']).execute(),
    db.selectFrom('interactionParticipants').select(['interactionId', 'personId']).execute(),
    db.selectFrom('memoryLinks').select(['memoryId', 'recordType', 'recordId']).execute(),
  ])

  const edges: GraphEdge[] = []

  if (selfId) {
    for (const person of people) {
      if (person.id !== selfId) edges.push({ source: selfId, target: person.id, kind: 'knows' })
    }
    for (const project of projects) {
      edges.push({ source: selfId, target: project.id, kind: 'owns' })
    }
  }
  for (const row of affiliations) {
    if (inScope(row.personId, row.organizationId)) {
      edges.push({ source: row.personId, target: row.organizationId, kind: 'affiliation' })
    }
  }
  for (const row of projectPeople) {
    if (inScope(row.projectId, row.personId)) {
      edges.push({ source: row.projectId, target: row.personId, kind: 'member' })
    }
  }
  for (const task of tasks) {
    if (task.projectId && projectIds.has(task.projectId)) {
      edges.push({ source: task.projectId, target: task.id, kind: 'task' })
    }
  }
  // Interactions are edges, not nodes: dissolve each into weighted links between
  // the people it involved.
  const activeInteractionIds = new Set(interactions.map((interaction) => interaction.id))
  const peopleByInteraction = groupInteractionPeople(interactions, participants, personIds)
  edges.push(
    ...deriveMemoryEdges(memoryLinks, nodeIds, peopleByInteraction, activeInteractionIds, selfId),
  )
  edges.push(...deriveInteractionEdges(interactions, participants, personIds, selfId))

  return { selfId, nodes, edges }
}
