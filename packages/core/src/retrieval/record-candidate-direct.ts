import { sql, type RawBuilder } from 'kysely'
import { db } from '../db/client'
import { toLikePattern } from './match-query'
import {
  candidateRecordTime,
  newInternalCandidate,
  type InternalCandidate,
  type RecordCandidateSearchOptions,
} from './record-candidate-types'
import type { SourceRecordType } from './retrieve'

interface DirectRow {
  recordId: string
  title: string | null
  summaryText: string | null
  typedText: string | null
  recordDate: string | null
  recordKind: string | null
}

interface DirectSource {
  recordType: Extract<
    SourceRecordType,
    'person' | 'organization' | 'project' | 'task' | 'document' | 'interaction' | 'memory'
  >
  table: string
  titleColumn: string
  summaryColumns: readonly string[]
  typedColumns: readonly string[]
  dateExpression: string
  kindColumn?: string
}

const DIRECT_SOURCES: readonly DirectSource[] = [
  {
    recordType: 'person',
    table: 'people',
    titleColumn: 'full_name',
    summaryColumns: ['headline', 'summary', 'notes'],
    typedColumns: [
      'preferred_name',
      'primary_email',
      'primary_phone',
      'location',
      'city',
      'region',
      'country',
      'current_title',
      'current_department',
      'role_family',
      'seniority',
    ],
    dateExpression: 'COALESCE(r.last_interaction_at, r.updated_at)',
  },
  {
    recordType: 'organization',
    table: 'organizations',
    titleColumn: 'name',
    summaryColumns: ['headline', 'summary', 'notes'],
    typedColumns: ['kind', 'domain', 'website', 'industry', 'location', 'hq_city', 'hq_region', 'hq_country'],
    dateExpression: 'r.updated_at',
  },
  {
    recordType: 'project',
    table: 'projects',
    titleColumn: 'name',
    summaryColumns: ['summary', 'notes'],
    typedColumns: ['status', 'kind'],
    dateExpression: 'COALESCE(r.completed_on, r.target_date, r.updated_at)',
  },
  {
    recordType: 'task',
    table: 'tasks',
    titleColumn: 'title',
    summaryColumns: ['description'],
    typedColumns: ['status'],
    dateExpression: 'COALESCE(r.due_at, r.scheduled_for, r.updated_at)',
  },
  {
    recordType: 'document',
    table: 'documents',
    titleColumn: 'title',
    summaryColumns: ['summary'],
    typedColumns: ['kind', 'mime_type', 'original_url'],
    dateExpression: 'COALESCE(r.occurred_at, r.authored_at, r.updated_at)',
  },
  {
    recordType: 'interaction',
    table: 'interactions',
    titleColumn: 'title',
    summaryColumns: ['summary'],
    typedColumns: ['kind', 'location', 'original_url'],
    dateExpression: 'COALESCE(r.occurred_at, r.updated_at)',
    kindColumn: 'kind',
  },
  {
    recordType: 'memory',
    table: 'memories',
    titleColumn: 'claim',
    summaryColumns: [],
    typedColumns: ['kind'],
    dateExpression: 'COALESCE(r.valid_from, r.updated_at)',
    kindColumn: 'kind',
  },
]

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const QUESTION_WORDS = new Set([
  'a', 'an', 'and', 'are', 'did', 'do', 'for', 'from', 'how', 'in', 'is', 'of', 'on',
  'the', 'to', 'was', 'what', 'when', 'where', 'who', 'with',
])

function fold(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function queryTerms(query: string): string[] {
  const all = query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const useful = all.filter((term) => term.length > 1 && !QUESTION_WORDS.has(term))
  return [...new Set(useful.length > 0 ? useful : all)]
}

function concatenatedColumns(columns: readonly string[]): RawBuilder<unknown> {
  if (columns.length === 0) return sql`''`
  return sql.raw(columns.map((column) => `COALESCE(r.${column}, '')`).join(" || ' ' || "))
}

function matchesAny(
  value: RawBuilder<unknown>,
  patterns: readonly string[],
): RawBuilder<unknown> {
  if (patterns.length === 0) return sql`0`
  return sql`(${sql.join(
    patterns.map((pattern) => sql`lower(${value}) LIKE lower(${pattern}) ESCAPE '\\'`),
    sql` OR `,
  )})`
}

function sourceAllowed(source: DirectSource, options: RecordCandidateSearchOptions): boolean {
  const recordTypes = options.recordTypes ?? (options.recordType ? [options.recordType] : undefined)
  if (recordTypes?.length && !recordTypes.includes(source.recordType)) return false
  return !(options.kinds?.length && source.recordType !== 'interaction')
}

async function directSourceHits(
  source: DirectSource,
  query: string,
  options: RecordCandidateSearchOptions,
  allowed: ReadonlySet<string> | undefined,
  limit: number,
): Promise<InternalCandidate[]> {
  const title = sql.raw(`r.${source.titleColumn}`)
  const summary = concatenatedColumns(source.summaryColumns)
  const typed = concatenatedColumns(source.typedColumns)
  const date = sql.raw(source.dateExpression)
  const kind = source.kindColumn ? sql.raw(`r.${source.kindColumn}`) : sql`NULL`
  const haystack = sql`lower(COALESCE(${title}, '') || ' ' || ${summary} || ' ' || ${typed})`
  const terms = queryTerms(query)
  const patterns = [...new Set([query, ...terms].map(toLikePattern).filter((value): value is string => Boolean(value)))]
  const termPatterns = terms
    .map(toLikePattern)
    .filter((value): value is string => Boolean(value))
  const foldedQuery = fold(query)
  const exactTitle = foldedQuery
    ? sql`CASE WHEN lower(trim(${title})) = ${foldedQuery} THEN 1 ELSE 0 END`
    : sql`0`
  const titleMatch = matchesAny(title, patterns)
  const summaryMatch = matchesAny(summary, patterns)
  const quality = sql`CASE
    WHEN ${exactTitle} = 1 THEN 0
    WHEN ${titleMatch} THEN 1
    WHEN ${summaryMatch} THEN 2
    ELSE 3
  END`
  const termMatches = termPatterns.length > 0
    ? sql`(${sql.join(
        termPatterns.map(
          (pattern) => sql`CASE WHEN ${haystack} LIKE lower(${pattern}) ESCAPE '\\' THEN 1 ELSE 0 END`,
        ),
        sql` + `,
      )})`
    : sql`0`
  const conditions: RawBuilder<unknown>[] = []
  if (patterns.length > 0) {
    conditions.push(matchesAny(haystack, patterns))
  }
  if (options.after) conditions.push(sql`${date} >= ${options.after}`)
  if (options.before) {
    const before = DATE_ONLY.test(options.before) ? `${options.before}T23:59:59.999Z` : options.before
    conditions.push(sql`${date} <= ${before}`)
  }
  if (options.kinds?.length && source.recordType === 'interaction') {
    conditions.push(sql`${kind} IN (${sql.join(options.kinds.map((value) => sql`${value}`))})`)
  }
  if (allowed) {
    const prefix = `${source.recordType}:`
    const ids = [...allowed].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length))
    conditions.push(ids.length > 0 ? sql`r.id IN (${sql.join(ids.map((id) => sql`${id}`))})` : sql`0`)
  }
  const where = conditions.length > 0 ? sql`AND ${sql.join(conditions, sql` AND `)}` : sql``
  const order = foldedQuery && options.sort !== 'recency'
    ? sql`${exactTitle} DESC, ${quality}, ${termMatches} DESC, ${date} DESC, r.id`
    : sql`${date} DESC, r.id`
  const result = await sql<DirectRow>`
    SELECT r.id AS "recordId", ${title} AS "title", ${summary} AS "summaryText",
      ${typed} AS "typedText", ${date} AS "recordDate", ${kind} AS "recordKind"
    FROM ${sql.raw(source.table)} r
    WHERE r.archived_at IS NULL ${where}
    ORDER BY ${order}
    LIMIT ${limit}
  `.execute(db)

  const candidates = result.rows.map((row) => {
    const candidate = newInternalCandidate(source.recordType, row.recordId, row.title, row.recordDate, [])
    if (!foldedQuery) {
      candidate.matchReasons = ['recent']
      return candidate
    }
    const titleText = fold(row.title)
    const summaryText = fold(row.summaryText)
    const typedText = fold(row.typedText)
    candidate.exactTitle = titleText === foldedQuery
    const titleMatch = titleText.includes(foldedQuery) || terms.some((term) => titleText.includes(term))
    const summaryMatch = summaryText.includes(foldedQuery) || terms.some((term) => summaryText.includes(term))
    const typedMatch = typedText.includes(foldedQuery) || terms.some((term) => typedText.includes(term))
    candidate.matchReasons = [
      ...(candidate.exactTitle ? ['exact_title'] : []),
      ...(!candidate.exactTitle && titleMatch ? ['title'] : []),
      ...(summaryMatch ? ['summary'] : []),
      ...(typedMatch ? ['typed_field'] : []),
    ]
    candidate.termMatches = terms.filter((term) => `${titleText} ${summaryText} ${typedText}`.includes(term)).length
    candidate.quality = candidate.exactTitle ? 0 : titleMatch ? 1 : summaryMatch ? 2 : 3
    return candidate
  })
  return candidates.sort(
    options.sort === 'recency'
      ? (a, b) => candidateRecordTime(b.date) - candidateRecordTime(a.date)
      : compareDirect,
  )
}

function compareDirect(a: InternalCandidate, b: InternalCandidate): number {
  return Number(b.exactTitle) - Number(a.exactTitle)
    || a.quality - b.quality
    || b.termMatches - a.termMatches
    || candidateRecordTime(b.date) - candidateRecordTime(a.date)
}

/** Search every direct record source concurrently and merge its ranked rows. */
export async function searchDirectRecordCandidates(
  query: string,
  options: RecordCandidateSearchOptions,
  allowed: ReadonlySet<string> | undefined,
  limit: number,
): Promise<InternalCandidate[]> {
  const lists = await Promise.all(
    DIRECT_SOURCES.filter((source) => sourceAllowed(source, options)).map((source) =>
      directSourceHits(source, query, options, allowed, limit),
    ),
  )
  return lists.flat().sort(compareDirect).slice(0, limit)
}
