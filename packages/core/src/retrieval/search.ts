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
 *
 * The CLI keeps a behavioural twin of this in `apps/cli/src/commands/read.rs`
 * (`brain search`); the tag grammar, ranking, and dedup live in the sibling
 * modules ({@link parseSearchQuery}, {@link tagFilterClauses}, {@link dedupeAndRank}).
 * Keep the two in sync.
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

/**
 * Full-text sources searched with FTS5 + bm25. Documents and interactions share
 * the same FTS shape (title/summary/body columns, title-weighted) and only
 * differ in their table, FTS index, and "record date" column. Assets use a
 * different projection (extra join, four FTS columns) and are queried inline.
 */
const FTS_SOURCES: ReadonlyArray<{
  kind: RecordKind
  fts: string
  table: string
  dateColumn: string
}> = [
  { kind: 'document', fts: 'documents_fts', table: 'documents', dateColumn: 'updated_at' },
  { kind: 'interaction', fts: 'interactions_fts', table: 'interactions', dateColumn: 'occurred_at' },
]

/**
 * Name/title sources matched by LIKE. All share one shape and only differ in the
 * table plus which columns supply the title and subtitle.
 */
const NAME_SOURCES: ReadonlyArray<{
  kind: RecordKind
  table: string
  titleColumn: string
  subtitleColumn: string
}> = [
  { kind: 'person', table: 'people', titleColumn: 'full_name', subtitleColumn: 'headline' },
  { kind: 'organization', table: 'organizations', titleColumn: 'name', subtitleColumn: 'kind' },
  { kind: 'project', table: 'projects', titleColumn: 'name', subtitleColumn: 'status' },
  { kind: 'task', table: 'tasks', titleColumn: 'title', subtitleColumn: 'status' },
]

function wants(kinds: readonly RecordKind[] | undefined, kind: RecordKind): boolean {
  return !kinds || kinds.includes(kind)
}

/**
 * Flat score for a name/title (LIKE) hit. Name hits have no bm25 to blend, so
 * the fixed lexical component sits at a mid-rank — above weak full-text matches,
 * below strong ones — and recency still tips the balance between name hits.
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

  // bm25 column weights shared by the document/interaction FTS sources. The
  // snippet delimiters below (`[` … `]`) are parsed by the desktop palette's
  // Snippet renderer — keep them in sync with apps/desktop command-palette.tsx.
  const ftsWeights = sql.raw('10.0, 1.0, 2.0')

  function runFtsSearch(source: (typeof FTS_SOURCES)[number], matchQuery: string): Promise<SearchHit[]> {
    const fts = sql.raw(source.fts)
    const table = sql.raw(source.table)
    const dateColumn = sql.raw(source.dateColumn)
    return sql<FtsRecordRow>`
        SELECT t.id AS "id", t.title AS "title", t.kind AS "subtitle",
               COALESCE(
                 NULLIF(snippet(${fts}, 1, '[', ']', '…', 10), ''),
                 NULLIF(snippet(${fts}, 2, '[', ']', '…', 10), ''),
                 NULLIF(snippet(${fts}, 0, '[', ']', '…', 10), '')
               ) AS "snippet",
               t.${dateColumn} AS "recordDate",
               bm25(${fts}, ${ftsWeights}) AS "bm25"
        FROM ${fts}
        JOIN ${table} t ON t.rowid = ${fts}.rowid
        WHERE ${fts} MATCH ${matchQuery} AND t.archived_at IS NULL
          ${tagFilterClauses(source.kind, sql`t.id`, parsed.tagFilters)}
        ORDER BY bm25(${fts}, ${ftsWeights}) LIMIT ${perKind}
      `
      .execute(db)
      .then((r) => r.rows.map((row) => ftsHit(source.kind, row, now)))
  }

  function runNameSearch(source: (typeof NAME_SOURCES)[number], likePattern: string): Promise<SearchHit[]> {
    const table = sql.raw(source.table)
    const titleColumn = sql.raw(source.titleColumn)
    const subtitleColumn = sql.raw(source.subtitleColumn)
    return sql<NameRow>`
        SELECT id AS "id", ${titleColumn} AS "title", ${subtitleColumn} AS "subtitle", updated_at AS "recordDate"
        FROM ${table}
        WHERE archived_at IS NULL
          AND ${titleColumn} LIKE ${likePattern} ESCAPE '\\'
          ${tagFilterClauses(source.kind, sql.raw(`${source.table}.id`), parsed.tagFilters)}
        ORDER BY ${titleColumn} ASC
        LIMIT ${perKind}
      `
      .execute(db)
      .then((r) => r.rows.map((row) => nameHit(source.kind, row, now)))
  }

  if (match) {
    for (const source of FTS_SOURCES) {
      if (wants(options.kinds, source.kind)) tasks.push(runFtsSearch(source, match))
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
            ${tagFilterClauses('asset', sql`s.asset_id`, parsed.tagFilters)}
          ORDER BY bm25(assets_fts, 10.0, 2.0, 2.0, 1.0) LIMIT ${perKind}
        `
          .execute(db)
          .then((r) => r.rows.map((row) => ftsHit('asset', row, now))),
      )
    }
  }

  if (like) {
    for (const source of NAME_SOURCES) {
      if (wants(options.kinds, source.kind)) tasks.push(runNameSearch(source, like))
    }
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
