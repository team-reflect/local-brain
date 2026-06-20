import { db } from '../db/client'

/**
 * The user-centered knowledge graph. A read-only assembler that loads the
 * (non-archived) records and the typed join tables, then returns a node/edge
 * model centered on the user's own person row:
 *
 * - the self row is the hub; edges fan out to the people you know and the
 *   projects you own, so the map reads as "you, and everything around you";
 * - join-table edges (affiliations, project membership, project tasks,
 *   interaction participants, memory links) wire the rest of the network.
 *
 * The graph is intentionally uncapped: every visible typed record is returned.
 * Layout and rendering performance belong in the graph surface, not in the data
 * contract.
 */

export type GraphNodeKind =
  | 'self'
  | 'person'
  | 'organization'
  | 'project'
  | 'task'
  | 'document'
  | 'interaction'
  | 'memory'

export interface GraphNode {
  id: string
  kind: GraphNodeKind
  label: string
}

export interface GraphEdge {
  source: string
  target: string
  kind: 'knows' | 'owns' | 'affiliation' | 'member' | 'task' | 'participant' | 'memory'
}

export interface Graph {
  selfId: string | null
  nodes: GraphNode[]
  edges: GraphEdge[]
}

function label(value: string | null, fallback: string): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return fallback
  return trimmed
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
      db
        .selectFrom('interactions')
        .where('archivedAt', 'is', null)
        .orderBy('occurredAt', 'desc')
        .select(['id', 'title', 'kind'])
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
    ...interactions.map<GraphNode>((interaction) => ({
      id: interaction.id,
      kind: 'interaction',
      label: label(interaction.title, interaction.kind),
    })),
    ...memories.map<GraphNode>((memory) => ({
      id: memory.id,
      kind: 'memory',
      label: label(memory.claim, 'Memory'),
    })),
  ]
  const nodeIds = new Set(nodes.map((node) => node.id))

  // Only wire join-table edges whose endpoints are visible records.
  const inScope = (...ids: string[]): boolean => ids.every((id) => nodeIds.has(id))
  const projectIds = new Set(projects.map((project) => project.id))

  const [affiliations, projectPeople, participants, memoryLinks] = await Promise.all([
    db.selectFrom('affiliations').select(['personId', 'organizationId']).execute(),
    db.selectFrom('projectPeople').select(['projectId', 'personId']).execute(),
    db.selectFrom('interactionParticipants').select(['interactionId', 'personId']).execute(),
    db.selectFrom('memoryLinks').select(['memoryId', 'recordId']).execute(),
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
  for (const row of participants) {
    if (row.personId === null) continue
    if (inScope(row.interactionId, row.personId)) {
      edges.push({ source: row.interactionId, target: row.personId, kind: 'participant' })
    }
  }
  for (const row of memoryLinks) {
    if (inScope(row.memoryId, row.recordId)) {
      edges.push({ source: row.memoryId, target: row.recordId, kind: 'memory' })
    }
  }

  return { selfId, nodes, edges }
}
