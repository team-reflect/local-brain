import { sql } from 'kysely'
import { db } from '../db/client'
import type { RecordKind } from '../domains/relations/types'
import { combineScore, lexicalScore, recencyScore } from './ranking'
import { toLikePattern, toMatchQuery } from './match-query'
import { parseSearchQuery } from './search-query'
import { dedupeAndRank } from './search-merge'
import { shouldSearchTaggedRecords, taggedRecordRows, tagFilterClauses, type TagRecordRow } from './search-tags'
import type { SearchHit, SearchOptions } from './search-types'
export type { SearchHit, SearchOptions } from './search-types'

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
  recordDate: string | null
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
const TAG_HIT_SCORE = 0.58

export async function globalSearch(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
  const perKind = options.perKind ?? DEFAULT_PER_KIND
  const limit = options.limit ?? DEFAULT_LIMIT
  const now = options.now ?? new Date()
  const parsed = parseSearchQuery(query)
  const match = toMatchQuery(parsed.text)
  const like = toLikePattern(parsed.text)
  const tagLike = toLikePattern(parsed.text.toLowerCase())
  if (!match && !like && parsed.tagFilters.length === 0) return []

  const tasks: Promise<SearchHit[]>[] = []

  if (match && wants(options.kinds, 'document')) {
    tasks.push(
      sql<FtsRecordRow>`
        SELECT d.id AS "id", d.title AS "title", d.kind AS "subtitle",
               COALESCE(
                 NULLIF(snippet(documents_fts, 1, '[', ']', '…', 10), ''),
                 NULLIF(snippet(documents_fts, 2, '[', ']', '…', 10), ''),
                 NULLIF(snippet(documents_fts, 0, '[', ']', '…', 10), '')
               ) AS "snippet",
               d.updated_at AS "recordDate",
               bm25(documents_fts, 10.0, 1.0, 2.0) AS "bm25"
        FROM documents_fts
        JOIN documents d ON d.rowid = documents_fts.rowid
        WHERE documents_fts MATCH ${match} AND d.archived_at IS NULL
          ${tagFilterClauses('document', sql`d.id`, parsed.tagFilters)}
        ORDER BY bm25(documents_fts, 10.0, 1.0, 2.0) LIMIT ${perKind}
      `
        .execute(db)
        .then((r) => r.rows.map((row) => ftsHit('document', row, now))),
    )
  }

  if (match && wants(options.kinds, 'interaction')) {
    tasks.push(
      sql<FtsRecordRow>`
        SELECT i.id AS "id", i.title AS "title", i.kind AS "subtitle",
               COALESCE(
                 NULLIF(snippet(interactions_fts, 1, '[', ']', '…', 10), ''),
                 NULLIF(snippet(interactions_fts, 2, '[', ']', '…', 10), ''),
                 NULLIF(snippet(interactions_fts, 0, '[', ']', '…', 10), '')
               ) AS "snippet",
               i.occurred_at AS "recordDate",
               bm25(interactions_fts, 10.0, 1.0, 2.0) AS "bm25"
        FROM interactions_fts
        JOIN interactions i ON i.rowid = interactions_fts.rowid
        WHERE interactions_fts MATCH ${match} AND i.archived_at IS NULL
          ${tagFilterClauses('interaction', sql`i.id`, parsed.tagFilters)}
        ORDER BY bm25(interactions_fts, 10.0, 1.0, 2.0) LIMIT ${perKind}
      `
        .execute(db)
        .then((r) => r.rows.map((row) => ftsHit('interaction', row, now))),
    )
  }

  if (match && wants(options.kinds, 'asset')) {
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
          ${tagFilterClauses('asset', sql`s.asset_id`, parsed.tagFilters)}
        ORDER BY bm25(assets_fts, 10.0, 2.0, 2.0, 1.0) LIMIT ${perKind}
      `
        .execute(db)
        .then((r) => r.rows.map((row) => ftsHit('asset', row, now))),
    )
  }

  if (like && wants(options.kinds, 'person')) {
    tasks.push(
      sql<NameRow>`
        SELECT id AS "id", full_name AS "title", headline AS "subtitle", updated_at AS "recordDate"
        FROM people
        WHERE archived_at IS NULL
          AND full_name LIKE ${like} ESCAPE '\\'
          ${tagFilterClauses('person', sql`people.id`, parsed.tagFilters)}
        ORDER BY full_name ASC
        LIMIT ${perKind}
      `
        .execute(db)
        .then((r) => r.rows.map((row) => nameHit('person', row, now))),
    )
  }

  if (like && wants(options.kinds, 'organization')) {
    tasks.push(
      sql<NameRow>`
        SELECT id AS "id", name AS "title", kind AS "subtitle", updated_at AS "recordDate"
        FROM organizations
        WHERE archived_at IS NULL
          AND name LIKE ${like} ESCAPE '\\'
          ${tagFilterClauses('organization', sql`organizations.id`, parsed.tagFilters)}
        ORDER BY name ASC
        LIMIT ${perKind}
      `
        .execute(db)
        .then((r) => r.rows.map((row) => nameHit('organization', row, now))),
    )
  }

  if (like && wants(options.kinds, 'project')) {
    tasks.push(
      sql<NameRow>`
        SELECT id AS "id", name AS "title", status AS "subtitle", updated_at AS "recordDate"
        FROM projects
        WHERE archived_at IS NULL
          AND name LIKE ${like} ESCAPE '\\'
          ${tagFilterClauses('project', sql`projects.id`, parsed.tagFilters)}
        ORDER BY name ASC
        LIMIT ${perKind}
      `
        .execute(db)
        .then((r) => r.rows.map((row) => nameHit('project', row, now))),
    )
  }

  if (like && wants(options.kinds, 'task')) {
    tasks.push(
      sql<NameRow>`
        SELECT id AS "id", title AS "title", status AS "subtitle", updated_at AS "recordDate"
        FROM tasks
        WHERE archived_at IS NULL
          AND title LIKE ${like} ESCAPE '\\'
          ${tagFilterClauses('task', sql`tasks.id`, parsed.tagFilters)}
        ORDER BY title ASC
        LIMIT ${perKind}
      `
        .execute(db)
        .then((r) => r.rows.map((row) => nameHit('task', row, now))),
    )
  }

  if (parsed.tagFilters.length > 0 || tagLike) {
    tasks.push(
      shouldSearchTaggedRecords({
        hasText: parsed.text.trim().length > 0,
        tagFilters: parsed.tagFilters,
        tagLike,
      }).then(async (shouldSearchTags) => {
        if (!shouldSearchTags) return []
        const rows = await taggedRecordRows({
          tagFilters: parsed.tagFilters,
          tagLike,
          limit: perKind * 7,
          ...(options.kinds ? { kinds: options.kinds } : {}),
        })
        return rows.map((row) => tagHit(row, now))
      }),
    )
  }

  const groups = await Promise.all(tasks)
  return dedupeAndRank(groups.flat()).slice(0, limit)
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

function nameHit(kind: RecordKind, row: NameRow, now: Date): SearchHit {
  const recency = recencyScore(row.recordDate, now)
  return {
    kind,
    id: row.id,
    title: row.title ?? '(untitled)',
    subtitle: row.subtitle,
    snippet: null,
    score: combineScore({ lexical: NAME_HIT_SCORE, recency }),
  }
}

function tagHit(row: TagRecordRow, now: Date): SearchHit {
  const recency = recencyScore(row.recordDate, now)
  return {
    kind: row.kind,
    id: row.id,
    title: row.title ?? '(untitled)',
    subtitle: row.subtitle,
    snippet: row.snippet,
    score: combineScore({ lexical: TAG_HIT_SCORE, recency }),
  }
}
