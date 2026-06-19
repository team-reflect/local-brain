import { sql } from 'kysely'
import { db } from '../db/client'
import type { RecordKind } from '../domains/relations/types'
import { combineScore, lexicalScore, recencyScore } from './ranking'
import { toLikePattern, toMatchQuery } from './match-query'

/**
 * Global search across the visible record types, for the command/search
 * palette and the search surface. Documents and interactions are searched by
 * full text (FTS5 over title + body, title-weighted); people, organizations,
 * projects, and tasks are matched on their names/titles; assets use their own
 * FTS projection over metadata, linked-record context, and optional local text.
 * Results are merged and ranked into one list.
 *
 * This is the navigational/find surface. Grounded retrieval for agents
 * is {@link retrieve} over `content_chunks`; both share the same FTS index and
 * ranking helpers.
 */

export interface SearchHit {
  kind: RecordKind
  id: string
  title: string
  subtitle: string | null
  /** A short matched excerpt for FTS hits; null for name hits. */
  snippet: string | null
  score: number
}

export interface SearchOptions {
  /** Max hits per kind before the final merge. */
  perKind?: number
  /** Final result cap. */
  limit?: number
  /** Restrict to a subset of record kinds. */
  kinds?: readonly RecordKind[]
  now?: Date
}

const DEFAULT_PER_KIND = 6
const DEFAULT_LIMIT = 20

interface FtsRecordRow {
  id: string
  title: string | null
  subtitle: string | null
  snippet: string | null
  recordDate: string | null
  bm25: number
}

interface NameRow {
  id: string
  title: string | null
  subtitle: string | null
}

function wants(kinds: readonly RecordKind[] | undefined, kind: RecordKind): boolean {
  return !kinds || kinds.includes(kind)
}

/**
 * Flat score for a name/title (LIKE) hit. Name hits have no bm25 or recency to
 * blend, so they sit at a fixed mid-rank: above weak full-text matches, below
 * strong ones. Tune here if name hits should out- or under-rank text matches.
 */
const NAME_HIT_SCORE = 0.6

export async function globalSearch(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
  const perKind = options.perKind ?? DEFAULT_PER_KIND
  const limit = options.limit ?? DEFAULT_LIMIT
  const now = options.now ?? new Date()
  const match = toMatchQuery(query)
  const like = toLikePattern(query)
  if (!match || !like) return []

  const tasks: Promise<SearchHit[]>[] = []

  if (wants(options.kinds, 'document')) {
    tasks.push(
      sql<FtsRecordRow>`
        SELECT d.id AS "id", d.title AS "title", d.kind AS "subtitle",
               snippet(documents_fts, 1, '[', ']', '…', 10) AS "snippet",
               d.updated_at AS "recordDate",
               bm25(documents_fts, 10.0, 1.0) AS "bm25"
        FROM documents_fts
        JOIN documents d ON d.rowid = documents_fts.rowid
        WHERE documents_fts MATCH ${match} AND d.archived_at IS NULL
        ORDER BY bm25(documents_fts, 10.0, 1.0) LIMIT ${perKind}
      `
        .execute(db)
        .then((r) => r.rows.map((row) => ftsHit('document', row, now))),
    )
  }

  if (wants(options.kinds, 'interaction')) {
    tasks.push(
      sql<FtsRecordRow>`
        SELECT i.id AS "id", i.title AS "title", i.kind AS "subtitle",
               snippet(interactions_fts, 1, '[', ']', '…', 10) AS "snippet",
               i.occurred_at AS "recordDate",
               bm25(interactions_fts, 10.0, 1.0) AS "bm25"
        FROM interactions_fts
        JOIN interactions i ON i.rowid = interactions_fts.rowid
        WHERE interactions_fts MATCH ${match} AND i.archived_at IS NULL
        ORDER BY bm25(interactions_fts, 10.0, 1.0) LIMIT ${perKind}
      `
        .execute(db)
        .then((r) => r.rows.map((row) => ftsHit('interaction', row, now))),
    )
  }

  if (wants(options.kinds, 'asset')) {
    tasks.push(
      sql<FtsRecordRow>`
        SELECT s.asset_id AS "id", s.title AS "title", s.subtitle AS "subtitle",
               COALESCE(
                 NULLIF(snippet(assets_fts, 0, '[', ']', '…', 10), ''),
                 NULLIF(snippet(assets_fts, 2, '[', ']', '…', 10), ''),
                 NULLIF(snippet(assets_fts, 3, '[', ']', '…', 10), ''),
                 NULLIF(snippet(assets_fts, 1, '[', ']', '…', 10), '')
               ) AS "snippet",
               s.updated_at AS "recordDate",
               bm25(assets_fts, 10.0, 2.0, 2.0, 1.0) AS "bm25"
        FROM assets_fts
        JOIN asset_search s ON s.rowid = assets_fts.rowid
        JOIN assets a ON a.id = s.asset_id
        WHERE assets_fts MATCH ${match} AND a.archived_at IS NULL
        ORDER BY bm25(assets_fts, 10.0, 2.0, 2.0, 1.0) LIMIT ${perKind}
      `
        .execute(db)
        .then((r) => r.rows.map((row) => ftsHit('asset', row, now))),
    )
  }

  if (wants(options.kinds, 'person')) {
    tasks.push(
      db
        .selectFrom('people')
        .where('archivedAt', 'is', null)
        .where('fullName', 'like', like)
        .orderBy('fullName', 'asc')
        .limit(perKind)
        .select(['id', 'fullName as title', 'headline as subtitle'])
        .execute()
        .then((rows) => rows.map((row) => nameHit('person', row))),
    )
  }

  if (wants(options.kinds, 'organization')) {
    tasks.push(
      db
        .selectFrom('organizations')
        .where('archivedAt', 'is', null)
        .where('name', 'like', like)
        .orderBy('name', 'asc')
        .limit(perKind)
        .select(['id', 'name as title', 'kind as subtitle'])
        .execute()
        .then((rows) => rows.map((row) => nameHit('organization', row))),
    )
  }

  if (wants(options.kinds, 'project')) {
    tasks.push(
      db
        .selectFrom('projects')
        .where('archivedAt', 'is', null)
        .where('name', 'like', like)
        .orderBy('name', 'asc')
        .limit(perKind)
        .select(['id', 'name as title', 'status as subtitle'])
        .execute()
        .then((rows) => rows.map((row) => nameHit('project', row))),
    )
  }

  if (wants(options.kinds, 'task')) {
    tasks.push(
      db
        .selectFrom('tasks')
        .where('archivedAt', 'is', null)
        .where('title', 'like', like)
        .orderBy('title', 'asc')
        .limit(perKind)
        .select(['id', 'title', 'status as subtitle'])
        .execute()
        .then((rows) => rows.map((row) => nameHit('task', row))),
    )
  }

  const groups = await Promise.all(tasks)
  return groups
    .flat()
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

function ftsHit(kind: RecordKind, row: FtsRecordRow, now: Date): SearchHit {
  // Same lexical + recency blend as grounded retrieval (see ranking.ts), minus
  // the link boost — global search has no "current context" to boost against.
  const lexical = lexicalScore(Number(row.bm25))
  const recency = recencyScore(row.recordDate, now)
  return {
    kind,
    id: row.id,
    title: row.title ?? '(untitled)',
    subtitle: row.subtitle,
    snippet: row.snippet ?? null,
    score: combineScore({ lexical, recency }),
  }
}

function nameHit(kind: RecordKind, row: NameRow): SearchHit {
  return {
    kind,
    id: row.id,
    title: row.title ?? '(untitled)',
    subtitle: row.subtitle,
    snippet: null,
    score: NAME_HIT_SCORE,
  }
}
