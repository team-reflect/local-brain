import { sql } from 'kysely'
import { db } from '../../db/client'
import type { LinkedRecord, RecordKind } from './types'

/**
 * Read-only "neighborhood" queries: for a given record, the records linked to it
 * through the typed join tables, returned as {@link LinkedRecord}s grouped by
 * target type. Detail pages call one `get<Entity>Links` per page; each runs its
 * group queries in parallel. Every base table here has `archived_at`, so
 * archived neighbors are hidden.
 */

interface RawRow {
  id: string
  title: string | null
  subtitle: string | null
}

function asLinks(kind: RecordKind, rows: RawRow[]): LinkedRecord[] {
  return rows.map((row) => ({
    kind,
    id: row.id,
    title: row.title ?? '(untitled)',
    subtitle: row.subtitle,
  }))
}

interface RawAssetRow {
  id: string
  title: string | null
  subtitle: string | null
}

async function getAssetLinks(recordType: string, recordId: string): Promise<LinkedRecord[]> {
  const rows = await sql<RawAssetRow>`
    SELECT a.id AS "id",
           COALESCE(NULLIF(trim(a.original_filename), ''), a.storage_path) AS "title",
           COALESCE(NULLIF(trim(a.mime_type), ''), NULLIF(trim(a.kind), '')) AS "subtitle"
    FROM assets a
    JOIN asset_links al ON al.asset_id = a.id
    WHERE al.record_type = ${recordType}
      AND al.record_id = ${recordId}
      AND a.archived_at IS NULL
    ORDER BY COALESCE(NULLIF(trim(a.original_filename), ''), a.storage_path) ASC
  `.execute(db)
  return asLinks('asset', rows.rows)
}

export interface PersonLinks {
  organizations: LinkedRecord[]
  projects: LinkedRecord[]
  tasks: LinkedRecord[]
  interactions: LinkedRecord[]
  documents: LinkedRecord[]
}

export async function getPersonLinks(personId: string): Promise<PersonLinks> {
  const [organizations, projects, tasks, interactions, documents] = await Promise.all([
    db
      .selectFrom('organizations')
      .innerJoin('affiliations', 'affiliations.organizationId', 'organizations.id')
      .where('affiliations.personId', '=', personId)
      .where('organizations.archivedAt', 'is', null)
      .orderBy('organizations.name', 'asc')
      .select(['organizations.id as id', 'organizations.name as title', 'affiliations.title as subtitle'])
      .execute(),
    db
      .selectFrom('projects')
      .innerJoin('projectPeople', 'projectPeople.projectId', 'projects.id')
      .where('projectPeople.personId', '=', personId)
      .where('projects.archivedAt', 'is', null)
      .orderBy('projects.name', 'asc')
      .select(['projects.id as id', 'projects.name as title', 'projects.status as subtitle'])
      .execute(),
    db
      .selectFrom('tasks')
      .innerJoin('taskPeople', 'taskPeople.taskId', 'tasks.id')
      .where('taskPeople.personId', '=', personId)
      .where('tasks.archivedAt', 'is', null)
      .orderBy('tasks.title', 'asc')
      .select(['tasks.id as id', 'tasks.title as title', 'tasks.status as subtitle'])
      .execute(),
    db
      .selectFrom('interactions')
      .innerJoin('interactionParticipants', 'interactionParticipants.interactionId', 'interactions.id')
      .where('interactionParticipants.personId', '=', personId)
      .where('interactions.archivedAt', 'is', null)
      .orderBy('interactions.occurredAt', 'desc')
      .select(['interactions.id as id', 'interactions.title as title', 'interactions.occurredAt as subtitle'])
      .execute(),
    db
      .selectFrom('documents')
      .innerJoin('documentPeople', 'documentPeople.documentId', 'documents.id')
      .where('documentPeople.personId', '=', personId)
      .where('documents.archivedAt', 'is', null)
      .orderBy('documents.title', 'asc')
      .select(['documents.id as id', 'documents.title as title', 'documents.kind as subtitle'])
      .execute(),
  ])
  return {
    organizations: asLinks('organization', organizations),
    projects: asLinks('project', projects),
    tasks: asLinks('task', tasks),
    interactions: asLinks('interaction', interactions),
    documents: asLinks('document', documents),
  }
}

export interface OrganizationLinks {
  people: LinkedRecord[]
  projects: LinkedRecord[]
  documents: LinkedRecord[]
  interactions: LinkedRecord[]
  tasks: LinkedRecord[]
}

export async function getOrganizationLinks(organizationId: string): Promise<OrganizationLinks> {
  const [people, projects, documents, interactions, tasks] = await Promise.all([
    db
      .selectFrom('people')
      .innerJoin('affiliations', 'affiliations.personId', 'people.id')
      .where('affiliations.organizationId', '=', organizationId)
      .where('people.archivedAt', 'is', null)
      .orderBy('people.fullName', 'asc')
      .select(['people.id as id', 'people.fullName as title', 'affiliations.title as subtitle'])
      .execute(),
    db
      .selectFrom('projects')
      .innerJoin('projectOrganizations', 'projectOrganizations.projectId', 'projects.id')
      .where('projectOrganizations.organizationId', '=', organizationId)
      .where('projects.archivedAt', 'is', null)
      .orderBy('projects.name', 'asc')
      .select(['projects.id as id', 'projects.name as title', 'projects.status as subtitle'])
      .execute(),
    db
      .selectFrom('documents')
      .innerJoin('documentOrganizations', 'documentOrganizations.documentId', 'documents.id')
      .where('documentOrganizations.organizationId', '=', organizationId)
      .where('documents.archivedAt', 'is', null)
      .orderBy('documents.title', 'asc')
      .select(['documents.id as id', 'documents.title as title', 'documents.kind as subtitle'])
      .execute(),
    db
      .selectFrom('interactions')
      .innerJoin('interactionOrganizations', 'interactionOrganizations.interactionId', 'interactions.id')
      .where('interactionOrganizations.organizationId', '=', organizationId)
      .where('interactions.archivedAt', 'is', null)
      .orderBy('interactions.occurredAt', 'desc')
      .select(['interactions.id as id', 'interactions.title as title', 'interactions.occurredAt as subtitle'])
      .execute(),
    db
      .selectFrom('tasks')
      .innerJoin('taskOrganizations', 'taskOrganizations.taskId', 'tasks.id')
      .where('taskOrganizations.organizationId', '=', organizationId)
      .where('tasks.archivedAt', 'is', null)
      .orderBy('tasks.title', 'asc')
      .select(['tasks.id as id', 'tasks.title as title', 'tasks.status as subtitle'])
      .execute(),
  ])
  return {
    people: asLinks('person', people),
    projects: asLinks('project', projects),
    documents: asLinks('document', documents),
    interactions: asLinks('interaction', interactions),
    tasks: asLinks('task', tasks),
  }
}

export interface ProjectLinks {
  people: LinkedRecord[]
  tasks: LinkedRecord[]
  documents: LinkedRecord[]
  interactions: LinkedRecord[]
  organizations: LinkedRecord[]
}

export async function getProjectLinks(projectId: string): Promise<ProjectLinks> {
  const [people, tasks, documents, interactions, organizations] = await Promise.all([
    db
      .selectFrom('people')
      .innerJoin('projectPeople', 'projectPeople.personId', 'people.id')
      .where('projectPeople.projectId', '=', projectId)
      .where('people.archivedAt', 'is', null)
      .orderBy('people.fullName', 'asc')
      .select(['people.id as id', 'people.fullName as title', 'projectPeople.role as subtitle'])
      .execute(),
    db
      .selectFrom('tasks')
      .where('tasks.projectId', '=', projectId)
      .where('tasks.archivedAt', 'is', null)
      .orderBy('tasks.dueAt', 'asc')
      .select(['tasks.id as id', 'tasks.title as title', 'tasks.status as subtitle'])
      .execute(),
    db
      .selectFrom('documents')
      .innerJoin('projectDocuments', 'projectDocuments.documentId', 'documents.id')
      .where('projectDocuments.projectId', '=', projectId)
      .where('documents.archivedAt', 'is', null)
      .orderBy('documents.title', 'asc')
      .select(['documents.id as id', 'documents.title as title', 'documents.kind as subtitle'])
      .execute(),
    db
      .selectFrom('interactions')
      .innerJoin('projectInteractions', 'projectInteractions.interactionId', 'interactions.id')
      .where('projectInteractions.projectId', '=', projectId)
      .where('interactions.archivedAt', 'is', null)
      .orderBy('interactions.occurredAt', 'desc')
      .select(['interactions.id as id', 'interactions.title as title', 'interactions.occurredAt as subtitle'])
      .execute(),
    db
      .selectFrom('organizations')
      .innerJoin('projectOrganizations', 'projectOrganizations.organizationId', 'organizations.id')
      .where('projectOrganizations.projectId', '=', projectId)
      .where('organizations.archivedAt', 'is', null)
      .orderBy('organizations.name', 'asc')
      .select(['organizations.id as id', 'organizations.name as title', 'organizations.kind as subtitle'])
      .execute(),
  ])
  return {
    people: asLinks('person', people),
    tasks: asLinks('task', tasks),
    documents: asLinks('document', documents),
    interactions: asLinks('interaction', interactions),
    organizations: asLinks('organization', organizations),
  }
}

export interface TaskLinks {
  projects: LinkedRecord[]
  /** All task-person links (any role). Includes assignees for backward compat. */
  people: LinkedRecord[]
  /** People with role='assignee' only. */
  assignees: LinkedRecord[]
  documents: LinkedRecord[]
  interactions: LinkedRecord[]
}

export async function getTaskLinks(taskId: string): Promise<TaskLinks> {
  const [projects, people, assignees, documents, interactions] = await Promise.all([
    db
      .selectFrom('projects')
      .innerJoin('tasks', 'tasks.projectId', 'projects.id')
      .where('tasks.id', '=', taskId)
      .where('projects.archivedAt', 'is', null)
      .orderBy('projects.name', 'asc')
      .select(['projects.id as id', 'projects.name as title', 'projects.status as subtitle'])
      .execute(),
    db
      .selectFrom('people')
      .innerJoin('taskPeople', 'taskPeople.personId', 'people.id')
      .where('taskPeople.taskId', '=', taskId)
      .where('people.archivedAt', 'is', null)
      .orderBy('people.fullName', 'asc')
      .select(['people.id as id', 'people.fullName as title', 'taskPeople.role as subtitle'])
      .execute(),
    db
      .selectFrom('people')
      .innerJoin('taskPeople', 'taskPeople.personId', 'people.id')
      .where('taskPeople.taskId', '=', taskId)
      .where('taskPeople.role', '=', 'assignee')
      .where('people.archivedAt', 'is', null)
      .orderBy('people.fullName', 'asc')
      .select(['people.id as id', 'people.fullName as title', 'taskPeople.role as subtitle'])
      .execute(),
    db
      .selectFrom('documents')
      .innerJoin('taskDocuments', 'taskDocuments.documentId', 'documents.id')
      .where('taskDocuments.taskId', '=', taskId)
      .where('documents.archivedAt', 'is', null)
      .orderBy('documents.title', 'asc')
      .select(['documents.id as id', 'documents.title as title', 'documents.kind as subtitle'])
      .execute(),
    db
      .selectFrom('interactions')
      .innerJoin('taskInteractions', 'taskInteractions.interactionId', 'interactions.id')
      .where('taskInteractions.taskId', '=', taskId)
      .where('interactions.archivedAt', 'is', null)
      .orderBy('interactions.occurredAt', 'desc')
      .select(['interactions.id as id', 'interactions.title as title', 'interactions.occurredAt as subtitle'])
      .execute(),
  ])
  return {
    projects: asLinks('project', projects),
    people: asLinks('person', people),
    assignees: asLinks('person', assignees),
    documents: asLinks('document', documents),
    interactions: asLinks('interaction', interactions),
  }
}

export interface DocumentLinks {
  people: LinkedRecord[]
  projects: LinkedRecord[]
  interactions: LinkedRecord[]
  tasks: LinkedRecord[]
  assets: LinkedRecord[]
}

export async function getDocumentLinks(documentId: string): Promise<DocumentLinks> {
  const [people, projects, interactions, tasks, assets] = await Promise.all([
    db
      .selectFrom('people')
      .innerJoin('documentPeople', 'documentPeople.personId', 'people.id')
      .where('documentPeople.documentId', '=', documentId)
      .where('people.archivedAt', 'is', null)
      .orderBy('people.fullName', 'asc')
      .select(['people.id as id', 'people.fullName as title', 'documentPeople.role as subtitle'])
      .execute(),
    db
      .selectFrom('projects')
      .innerJoin('projectDocuments', 'projectDocuments.projectId', 'projects.id')
      .where('projectDocuments.documentId', '=', documentId)
      .where('projects.archivedAt', 'is', null)
      .orderBy('projects.name', 'asc')
      .select(['projects.id as id', 'projects.name as title', 'projects.status as subtitle'])
      .execute(),
    db
      .selectFrom('interactions')
      .innerJoin('documentInteractions', 'documentInteractions.interactionId', 'interactions.id')
      .where('documentInteractions.documentId', '=', documentId)
      .where('interactions.archivedAt', 'is', null)
      .orderBy('interactions.occurredAt', 'desc')
      .select(['interactions.id as id', 'interactions.title as title', 'interactions.occurredAt as subtitle'])
      .execute(),
    db
      .selectFrom('tasks')
      .innerJoin('taskDocuments', 'taskDocuments.taskId', 'tasks.id')
      .where('taskDocuments.documentId', '=', documentId)
      .where('tasks.archivedAt', 'is', null)
      .orderBy('tasks.title', 'asc')
      .select(['tasks.id as id', 'tasks.title as title', 'tasks.status as subtitle'])
      .execute(),
    getAssetLinks('document', documentId),
  ])
  return {
    people: asLinks('person', people),
    projects: asLinks('project', projects),
    interactions: asLinks('interaction', interactions),
    tasks: asLinks('task', tasks),
    assets,
  }
}

export interface InteractionLinks {
  projects: LinkedRecord[]
  organizations: LinkedRecord[]
  documents: LinkedRecord[]
  tasks: LinkedRecord[]
  assets: LinkedRecord[]
}

export async function getInteractionLinks(interactionId: string): Promise<InteractionLinks> {
  const [projects, organizations, documents, tasks, assets] = await Promise.all([
    db
      .selectFrom('projects')
      .innerJoin('projectInteractions', 'projectInteractions.projectId', 'projects.id')
      .where('projectInteractions.interactionId', '=', interactionId)
      .where('projects.archivedAt', 'is', null)
      .orderBy('projects.name', 'asc')
      .select(['projects.id as id', 'projects.name as title', 'projects.status as subtitle'])
      .execute(),
    db
      .selectFrom('organizations')
      .innerJoin('interactionOrganizations', 'interactionOrganizations.organizationId', 'organizations.id')
      .where('interactionOrganizations.interactionId', '=', interactionId)
      .where('organizations.archivedAt', 'is', null)
      .orderBy('organizations.name', 'asc')
      .select(['organizations.id as id', 'organizations.name as title', 'organizations.kind as subtitle'])
      .execute(),
    db
      .selectFrom('documents')
      .innerJoin('documentInteractions', 'documentInteractions.documentId', 'documents.id')
      .where('documentInteractions.interactionId', '=', interactionId)
      .where('documents.archivedAt', 'is', null)
      .orderBy('documents.title', 'asc')
      .select(['documents.id as id', 'documents.title as title', 'documents.kind as subtitle'])
      .execute(),
    db
      .selectFrom('tasks')
      .innerJoin('taskInteractions', 'taskInteractions.taskId', 'tasks.id')
      .where('taskInteractions.interactionId', '=', interactionId)
      .where('tasks.archivedAt', 'is', null)
      .orderBy('tasks.title', 'asc')
      .select(['tasks.id as id', 'tasks.title as title', 'tasks.status as subtitle'])
      .execute(),
    getAssetLinks('interaction', interactionId),
  ])
  return {
    projects: asLinks('project', projects),
    organizations: asLinks('organization', organizations),
    documents: asLinks('document', documents),
    tasks: asLinks('task', tasks),
    assets,
  }
}
