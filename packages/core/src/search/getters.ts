import { sql } from 'kysely'
import { db } from '../db/client'
import type { LinkedRecord, RecordKind } from '../domains/relations/types'
import { toLikePattern } from '../retrieval/match-query'

/**
 * A lightweight, navigational quick-search for the command palette: case-
 * insensitive substring matching over the names/titles of the main record
 * types, returned as {@link LinkedRecord}s. This is deliberately simple; the
 * ranked search surface uses FTS-backed `globalSearch`.
 */

const PER_KIND = 5

function link(kind: RecordKind, id: string, title: string | null, subtitle: string | null): LinkedRecord {
  return { kind, id, title: title ?? '(untitled)', subtitle }
}

export async function quickSearch(query: string, perKind = PER_KIND): Promise<LinkedRecord[]> {
  // Share the LIKE-pattern builder with global search so both escape `%`/`_`
  // wildcards in user input identically.
  const like = toLikePattern(query)
  if (!like) return []

  const [people, organizations, projects, tasks, documents, interactions, assets] = await Promise.all([
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
    sql<{ id: string; title: string | null; subtitle: string | null }>`
      SELECT id AS "id",
             COALESCE(NULLIF(trim(original_filename), ''), storage_path) AS "title",
             COALESCE(NULLIF(trim(mime_type), ''), NULLIF(trim(kind), '')) AS "subtitle"
      FROM assets
      WHERE archived_at IS NULL
        AND (
          original_filename LIKE ${like} ESCAPE '\\'
          OR storage_path LIKE ${like} ESCAPE '\\'
          OR mime_type LIKE ${like} ESCAPE '\\'
          OR kind LIKE ${like} ESCAPE '\\'
        )
      ORDER BY title ASC
      LIMIT ${perKind}
    `
      .execute(db)
      .then((r) => r.rows),
  ])

  return [
    ...people.map((row) => link('person', row.id, row.fullName, row.headline)),
    ...organizations.map((row) => link('organization', row.id, row.name, row.kind)),
    ...projects.map((row) => link('project', row.id, row.name, row.status)),
    ...tasks.map((row) => link('task', row.id, row.title, row.status)),
    ...documents.map((row) => link('document', row.id, row.title, row.kind)),
    ...interactions.map((row) => link('interaction', row.id, row.title, row.kind)),
    ...assets.map((row) => link('asset', row.id, row.title, row.subtitle)),
  ]
}
