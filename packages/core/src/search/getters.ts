import { db } from '../db/client'
import type { LinkedRecord, RecordKind } from '../domains/relations/types'

/**
 * A lightweight, navigational quick-search for the command palette: case-
 * insensitive substring matching over the names/titles of the main record
 * types, returned as {@link LinkedRecord}s. This is deliberately simple —
 * full-text search and ranked retrieval (FTS5/embeddings) belong to Plan 06.
 */

const PER_KIND = 5

function link(kind: RecordKind, id: string, title: string | null, subtitle: string | null): LinkedRecord {
  return { kind, id, title: title ?? '(untitled)', subtitle }
}

export async function quickSearch(query: string, perKind = PER_KIND): Promise<LinkedRecord[]> {
  const needle = query.trim()
  if (!needle) return []
  const like = `%${needle}%`

  const [people, organizations, projects, tasks, documents, interactions] = await Promise.all([
    db
      .selectFrom('people')
      .where('archivedAt', 'is', null)
      .where('fullName', 'like', like)
      .orderBy('fullName', 'asc')
      .limit(perKind)
      .select(['id', 'fullName', 'headline'])
      .execute(),
    db
      .selectFrom('organizations')
      .where('archivedAt', 'is', null)
      .where('name', 'like', like)
      .orderBy('name', 'asc')
      .limit(perKind)
      .select(['id', 'name', 'kind'])
      .execute(),
    db
      .selectFrom('projects')
      .where('archivedAt', 'is', null)
      .where('name', 'like', like)
      .orderBy('name', 'asc')
      .limit(perKind)
      .select(['id', 'name', 'status'])
      .execute(),
    db
      .selectFrom('tasks')
      .where('archivedAt', 'is', null)
      .where('title', 'like', like)
      .orderBy('title', 'asc')
      .limit(perKind)
      .select(['id', 'title', 'status'])
      .execute(),
    db
      .selectFrom('documents')
      .where('archivedAt', 'is', null)
      .where('title', 'like', like)
      .orderBy('title', 'asc')
      .limit(perKind)
      .select(['id', 'title', 'kind'])
      .execute(),
    db
      .selectFrom('interactions')
      .where('archivedAt', 'is', null)
      .where('title', 'like', like)
      .orderBy('occurredAt', 'desc')
      .limit(perKind)
      .select(['id', 'title', 'kind'])
      .execute(),
  ])

  return [
    ...people.map((row) => link('person', row.id, row.fullName, row.headline)),
    ...organizations.map((row) => link('organization', row.id, row.name, row.kind)),
    ...projects.map((row) => link('project', row.id, row.name, row.status)),
    ...tasks.map((row) => link('task', row.id, row.title, row.status)),
    ...documents.map((row) => link('document', row.id, row.title, row.kind)),
    ...interactions.map((row) => link('interaction', row.id, row.title, row.kind)),
  ]
}
