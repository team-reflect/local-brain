import { db } from '../db/client'

/**
 * The user-centered knowledge graph. A read-only assembler that loads the
 * (non-archived) records and the typed join tables, then returns a node/edge
 * model centered on the user's own person row:
 *
 * - the self row is the hub; edges fan out to the people you know and the
 *   projects you own, so the map reads as "you, and everything around you";
 * - join-table edges (affiliations, project membership, project tasks,
 *   memory links) wire the rest of the network;
 * - interactions do not become graph nodes. They are evidence on links between
 *   people, organizations, projects, and tasks, so the graph stays a map of the
 *   relationship network instead of a cloud of emails and meetings.
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

export interface GraphEdge {
  source: string
  target: string
  kind: 'knows' | 'owns' | 'affiliation' | 'member' | 'task' | 'memory' | 'interaction'
  interactionCount?: number
  latestInteractionAt?: string | null
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

function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

function addInteractionEdge(
  edges: Map<string, GraphEdge>,
  source: string,
  target: string,
  latestInteractionAt: string | null,
): void {
  const [a, b] = orderedPair(source, target)
  const key = `${a}\u0000${b}\u0000interaction`
  const current = edges.get(key)
  if (!current) {
    edges.set(key, {
      source: a,
      target: b,
      kind: 'interaction',
      interactionCount: 1,
      latestInteractionAt,
    })
    return
  }

  current.interactionCount = (current.interactionCount ?? 0) + 1
  if (
    latestInteractionAt &&
    (!current.latestInteractionAt || latestInteractionAt > current.latestInteractionAt)
  ) {
    current.latestInteractionAt = latestInteractionAt
  }
}

export async function getGraph(): Promise<Graph> {
  const [people, organizations, projects, tasks, documents, memories] = await Promise.all([
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

  // Only wire join-table edges whose endpoints are visible records.
  const inScope = (...ids: string[]): boolean => ids.every((id) => nodeIds.has(id))
  const projectIds = new Set(projects.map((project) => project.id))

  const [
    affiliations,
    projectPeople,
    memoryLinks,
    interactionParticipants,
    interactionOrganizations,
    projectInteractions,
    taskInteractions,
    originTasks,
  ] = await Promise.all([
    db.selectFrom('affiliations').select(['personId', 'organizationId']).execute(),
    db.selectFrom('projectPeople').select(['projectId', 'personId']).execute(),
    db.selectFrom('memoryLinks').select(['memoryId', 'recordId']).execute(),
    db
      .selectFrom('interactionParticipants')
      .innerJoin('interactions', 'interactions.id', 'interactionParticipants.interactionId')
      .where('interactions.archivedAt', 'is', null)
      .where('interactionParticipants.personId', 'is not', null)
      .select([
        'interactionParticipants.interactionId',
        'interactionParticipants.personId',
        'interactions.occurredAt',
      ])
      .execute(),
    db
      .selectFrom('interactionOrganizations')
      .innerJoin('interactions', 'interactions.id', 'interactionOrganizations.interactionId')
      .where('interactions.archivedAt', 'is', null)
      .select([
        'interactionOrganizations.interactionId',
        'interactionOrganizations.organizationId',
        'interactions.occurredAt',
      ])
      .execute(),
    db
      .selectFrom('projectInteractions')
      .innerJoin('interactions', 'interactions.id', 'projectInteractions.interactionId')
      .where('interactions.archivedAt', 'is', null)
      .select([
        'projectInteractions.interactionId',
        'projectInteractions.projectId',
        'interactions.occurredAt',
      ])
      .execute(),
    db
      .selectFrom('taskInteractions')
      .innerJoin('interactions', 'interactions.id', 'taskInteractions.interactionId')
      .where('interactions.archivedAt', 'is', null)
      .select([
        'taskInteractions.interactionId',
        'taskInteractions.taskId',
        'interactions.occurredAt',
      ])
      .execute(),
    db
      .selectFrom('tasks')
      .innerJoin('interactions', 'interactions.id', 'tasks.originInteractionId')
      .where('tasks.archivedAt', 'is', null)
      .where('interactions.archivedAt', 'is', null)
      .select(['tasks.id', 'tasks.originInteractionId', 'interactions.occurredAt'])
      .execute(),
  ])

  const edges: GraphEdge[] = []
  const interactionEdges = new Map<string, GraphEdge>()

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
  for (const row of memoryLinks) {
    if (inScope(row.memoryId, row.recordId)) {
      edges.push({ source: row.memoryId, target: row.recordId, kind: 'memory' })
    }
  }

  const participantsByInteraction = new Map<string, typeof interactionParticipants>()
  for (const participant of interactionParticipants) {
    const group = participantsByInteraction.get(participant.interactionId) ?? []
    group.push(participant)
    participantsByInteraction.set(participant.interactionId, group)
  }
  const organizationsByInteraction = new Map<string, typeof interactionOrganizations>()
  for (const organization of interactionOrganizations) {
    const group = organizationsByInteraction.get(organization.interactionId) ?? []
    group.push(organization)
    organizationsByInteraction.set(organization.interactionId, group)
  }
  const projectsByInteraction = new Map<string, typeof projectInteractions>()
  for (const project of projectInteractions) {
    const group = projectsByInteraction.get(project.interactionId) ?? []
    group.push(project)
    projectsByInteraction.set(project.interactionId, group)
  }
  const tasksByInteraction = new Map<
    string,
    Array<{ interactionId: string; taskId: string; occurredAt: string | null }>
  >()
  for (const task of taskInteractions) {
    const group = tasksByInteraction.get(task.interactionId) ?? []
    group.push(task)
    tasksByInteraction.set(task.interactionId, group)
  }
  for (const task of originTasks) {
    if (!task.originInteractionId) continue
    const group = tasksByInteraction.get(task.originInteractionId) ?? []
    group.push({
      interactionId: task.originInteractionId,
      taskId: task.id,
      occurredAt: task.occurredAt,
    })
    tasksByInteraction.set(task.originInteractionId, group)
  }

  for (const [interactionId, participants] of participantsByInteraction) {
    for (let a = 0; a < participants.length; a += 1) {
      const source = participants[a]?.personId
      if (!source) continue
      for (let b = a + 1; b < participants.length; b += 1) {
        const target = participants[b]?.personId
        if (target && inScope(source, target)) {
          addInteractionEdge(
            interactionEdges,
            source,
            target,
            participants[a]?.occurredAt ?? participants[b]?.occurredAt ?? null,
          )
        }
      }
    }

    const participantIds = participants
      .map((participant) => participant.personId)
      .filter((id): id is string => Boolean(id))
    const hasSelfParticipant = selfId ? participantIds.includes(selfId) : false
    const organizations = organizationsByInteraction.get(interactionId) ?? []
    const projectsForInteraction = projectsByInteraction.get(interactionId) ?? []
    const tasksForInteraction = tasksByInteraction.get(interactionId) ?? []

    for (const personId of participantIds) {
      if (selfId && !hasSelfParticipant && personId !== selfId && inScope(selfId, personId)) {
        addInteractionEdge(interactionEdges, selfId, personId, participants[0]?.occurredAt ?? null)
      }
      for (const org of organizations) {
        if (inScope(personId, org.organizationId)) {
          addInteractionEdge(interactionEdges, personId, org.organizationId, org.occurredAt)
        }
      }
      for (const project of projectsForInteraction) {
        if (inScope(personId, project.projectId)) {
          addInteractionEdge(interactionEdges, personId, project.projectId, project.occurredAt)
        }
      }
      for (const task of tasksForInteraction) {
        if (inScope(personId, task.taskId)) {
          addInteractionEdge(interactionEdges, personId, task.taskId, task.occurredAt)
        }
      }
    }
  }

  return { selfId, nodes, edges: [...edges, ...interactionEdges.values()] }
}
