import { sql, type RawBuilder } from 'kysely'
import { db } from '../db/client'
import { embedStatus, embedTexts } from '../embeddings/commands'
import { EMBEDDING_MODEL_ID, isEmbedReady } from '../embeddings/model'
import { MAX_COSINE_DISTANCE } from '../embeddings/semantic'
import { isEmbeddingsEnabled } from '../embeddings/status'
import { toLikePattern, toMatchQuery } from './match-query'
import { combineScore, lexicalScore, recencyScore } from './ranking'
import type { RetrievalMode, SourceRecordType } from './retrieve'

/**
 * Filter-aware record search for Chat and agent workflows. Unlike globalSearch
 * (navigational) or retrieve() (chunk-first), this is record-first: metadata
 * filters decide the candidate records, then text/semantic matches attach
 * bounded excerpts for grounding.
 */

export type FilteredSearchRecordType =
  | 'document'
  | 'interaction'
  | 'interaction_transcript'
  | 'task'

export type FilteredSearchSort = 'relevance' | 'recent' | 'oldest' | 'updated'
export type FilteredSearchDateField = 'effective' | 'created' | 'updated'

export interface FilteredSearchDateFilter {
  from?: string
  to?: string
  field?: FilteredSearchDateField
}

export interface FilteredSearchHasFilter {
  transcript?: boolean
  text?: boolean
  sourceIdentity?: boolean
}

export interface FilteredSearchLinkedFilter {
  people?: readonly string[]
  organizations?: readonly string[]
  projects?: readonly string[]
  tasks?: readonly string[]
}

export interface FilteredSearchInput {
  query?: string
  recordTypes?: readonly FilteredSearchRecordType[]
  documentKinds?: readonly string[]
  interactionKinds?: readonly string[]
  taskStatuses?: readonly string[]
  date?: FilteredSearchDateFilter
  has?: FilteredSearchHasFilter
  sourceSlugs?: readonly string[]
  externalKinds?: readonly string[]
  linked?: FilteredSearchLinkedFilter
  sort?: FilteredSearchSort
  limit?: number
  excerptsPerRecord?: number
}

export interface FilteredSearchOptions {
  mode?: RetrievalMode
  now?: Date
  maxExcerptChars?: number
}

export interface FilteredSearchExcerpt {
  chunkId: string | null
  chunkIndex: number | null
  snippet: string
  text: string
  lexicalScore: number
  semanticScore: number | null
}

export interface FilteredSearchParent {
  recordType: 'interaction'
  recordId: string
  title: string | null
}

export interface FilteredSearchHit {
  recordType: FilteredSearchRecordType
  recordId: string
  title: string
  kind: string | null
  status: string | null
  date: string | null
  updatedAt: string | null
  parent: FilteredSearchParent | null
  sourceSlugs: string[]
  externalKinds: string[]
  hasTranscript: boolean
  score: number
  lexicalScore: number
  semanticScore: number | null
  excerpts: FilteredSearchExcerpt[]
}

export interface FilteredSearchResult {
  query: string | null
  mode: RetrievalMode
  semanticAvailable: boolean
  hits: FilteredSearchHit[]
  count: number
}

interface NormalizedSearch {
  query: string | null
  recordTypes: readonly FilteredSearchRecordType[]
  documentKinds: readonly string[]
  interactionKinds: readonly string[]
  taskStatuses: readonly string[]
  date: FilteredSearchDateFilter | null
  has: FilteredSearchHasFilter
  sourceSlugs: readonly string[]
  externalKinds: readonly string[]
  linked: {
    people: readonly string[]
    organizations: readonly string[]
    projects: readonly string[]
    tasks: readonly string[]
  }
  sort: FilteredSearchSort
  limit: number
  excerptsPerRecord: number
  now: Date
  maxExcerptChars: number
  mode: RetrievalMode
}

interface RecordRow {
  recordType: string
  recordId: string
  title: string | null
  kind: string | null
  status: string | null
  date: string | null
  createdAt: string | null
  updatedAt: string | null
  parentRecordType: string | null
  parentRecordId: string | null
  parentTitle: string | null
  hasTranscript: number | boolean | null
}

interface CandidateRow extends RecordRow {
  chunkId: string | null
  chunkIndex: number | null
  snippet: string | null
  text: string | null
  bm25: number | null
  semanticScore: number | null
}

interface SearchCandidate {
  record: BaseHit
  excerpt: FilteredSearchExcerpt | null
  score: number
  lexicalScore: number
  semanticScore: number | null
  rankKey: string
}

interface BaseHit {
  recordType: FilteredSearchRecordType
  recordId: string
  title: string
  kind: string | null
  status: string | null
  date: string | null
  createdAt: string | null
  updatedAt: string | null
  parent: FilteredSearchParent | null
  hasTranscript: boolean
}

interface SourceMeta {
  sourceSlugs: string[]
  externalKinds: string[]
}

const DEFAULT_LIMIT = 12
const MAX_LIMIT = 50
const DEFAULT_EXCERPTS = 1
const MAX_EXCERPTS = 5
const DEFAULT_MAX_EXCERPT_CHARS = 1200
const CANDIDATE_MULTIPLIER = 20
const MIN_KNN_CANDIDATES = 100
const MAX_KNN_CANDIDATES = 500

const FILTERED_RECORD_TYPES: readonly FilteredSearchRecordType[] = [
  'document',
  'interaction',
  'interaction_transcript',
  'task',
]

const DEFAULT_RECORD_TYPES: readonly FilteredSearchRecordType[] = [
  'document',
  'interaction',
  'interaction_transcript',
]

function cleanString(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function cleanList(values: readonly string[] | undefined, options: { lower?: boolean } = {}): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values ?? []) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const value = options.lower ? trimmed.toLowerCase() : trimmed
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function isFilteredRecordType(value: string): value is FilteredSearchRecordType {
  return (FILTERED_RECORD_TYPES as readonly string[]).includes(value)
}

function normalizeSearch(input: FilteredSearchInput, options: FilteredSearchOptions): NormalizedSearch {
  const requestedTypes: FilteredSearchRecordType[] = [...(input.recordTypes ?? [])].filter(isFilteredRecordType)
  const defaultTypes: readonly FilteredSearchRecordType[] =
    input.taskStatuses && input.taskStatuses.length > 0 ? [...DEFAULT_RECORD_TYPES, 'task'] : DEFAULT_RECORD_TYPES
  const recordTypes: readonly FilteredSearchRecordType[] =
    requestedTypes.length > 0
      ? requestedTypes
      : defaultTypes

  return {
    query: cleanString(input.query),
    recordTypes,
    documentKinds: cleanList(input.documentKinds),
    interactionKinds: cleanList(input.interactionKinds),
    taskStatuses: cleanList(input.taskStatuses),
    date: input.date ?? null,
    has: input.has ?? {},
    sourceSlugs: cleanList(input.sourceSlugs, { lower: true }),
    externalKinds: cleanList(input.externalKinds),
    linked: {
      people: cleanList(input.linked?.people),
      organizations: cleanList(input.linked?.organizations),
      projects: cleanList(input.linked?.projects),
      tasks: cleanList(input.linked?.tasks),
    },
    sort: input.sort ?? (cleanString(input.query) ? 'relevance' : 'recent'),
    limit: clampInt(input.limit, DEFAULT_LIMIT, 1, MAX_LIMIT),
    excerptsPerRecord: clampInt(input.excerptsPerRecord, DEFAULT_EXCERPTS, 1, MAX_EXCERPTS),
    now: options.now ?? new Date(),
    maxExcerptChars: clampInt(options.maxExcerptChars, DEFAULT_MAX_EXCERPT_CHARS, 120, 10_000),
    mode: options.mode ?? 'hybrid',
  }
}

function wants(norm: NormalizedSearch, recordType: FilteredSearchRecordType): boolean {
  return norm.recordTypes.includes(recordType)
}

function valueList(values: readonly string[]): RawBuilder<unknown> {
  return sql.join(values.map((value) => sql`${value}`), sql`, `)
}

function andClauses(clauses: readonly RawBuilder<unknown>[]): RawBuilder<unknown> {
  if (clauses.length === 0) return sql``
  return sql.join(clauses.map((clause) => sql`AND ${clause}`), sql` `)
}

function inList(expr: RawBuilder<unknown>, values: readonly string[]): RawBuilder<unknown> | null {
  return values.length > 0 ? sql`${expr} IN (${valueList(values)})` : null
}

function maybePush(clauses: RawBuilder<unknown>[], clause: RawBuilder<unknown> | null): void {
  if (clause) clauses.push(clause)
}

function interactionHasTranscript(interactionId: RawBuilder<unknown>): RawBuilder<unknown> {
  return sql`EXISTS (
    SELECT 1 FROM interaction_transcripts tr_has
    WHERE tr_has.interaction_id = ${interactionId}
  )`
}

function dateExpr(
  recordType: FilteredSearchRecordType,
  field: FilteredSearchDateField,
): RawBuilder<unknown> {
  if (recordType === 'document') {
    if (field === 'created') return sql`d.created_at`
    if (field === 'updated') return sql`d.updated_at`
    return sql`COALESCE(d.occurred_at, d.authored_at, d.updated_at, d.created_at)`
  }
  if (recordType === 'interaction') {
    if (field === 'created') return sql`i.created_at`
    if (field === 'updated') return sql`i.updated_at`
    return sql`COALESCE(i.occurred_at, i.updated_at, i.created_at)`
  }
  if (recordType === 'interaction_transcript') {
    if (field === 'created') return sql`tr.created_at`
    if (field === 'updated') return sql`tr.updated_at`
    return sql`COALESCE(parent_i.occurred_at, parent_i.updated_at, parent_i.created_at, tr.transcribed_at, tr.updated_at, tr.created_at)`
  }
  if (field === 'created') return sql`t.created_at`
  if (field === 'updated') return sql`t.updated_at`
  return sql`COALESCE(t.due_at, t.scheduled_for, t.updated_at, t.created_at)`
}

function dateClauses(norm: NormalizedSearch, recordType: FilteredSearchRecordType): RawBuilder<unknown>[] {
  const filter = norm.date
  if (!filter) return []
  const field = filter.field ?? 'effective'
  const expr = dateExpr(recordType, field)
  const clauses: RawBuilder<unknown>[] = []
  if (filter.from) clauses.push(sql`${expr} >= ${filter.from}`)
  if (filter.to) clauses.push(sql`${expr} <= ${filter.to}`)
  return clauses
}

interface RecordRefSql {
  recordType: string
  recordId: RawBuilder<unknown>
}

function refPredicate(
  typeExpr: RawBuilder<unknown>,
  idExpr: RawBuilder<unknown>,
  refs: readonly RecordRefSql[],
): RawBuilder<unknown> {
  return sql`(${sql.join(
    refs.map((ref) => sql`(${typeExpr} = ${ref.recordType} AND ${idExpr} = ${ref.recordId})`),
    sql` OR `,
  )})`
}

function sourceSlugCondition(
  refs: readonly RecordRefSql[],
  slugs: readonly string[],
  directSourceId?: RawBuilder<unknown>,
): RawBuilder<unknown> | null {
  if (slugs.length === 0) return null
  const parts: RawBuilder<unknown>[] = [
    sql`EXISTS (
      SELECT 1
      FROM record_provenance rp_src
      JOIN sources s_src ON s_src.id = rp_src.source_id
      WHERE ${refPredicate(sql`rp_src.record_type`, sql`rp_src.record_id`, refs)}
        AND s_src.slug IN (${valueList(slugs)})
    )`,
    sql`EXISTS (
      SELECT 1
      FROM external_identities ei_src
      JOIN sources s_src ON s_src.id = ei_src.source_id
      WHERE ${refPredicate(sql`ei_src.entity_type`, sql`ei_src.entity_id`, refs)}
        AND s_src.slug IN (${valueList(slugs)})
    )`,
  ]
  if (directSourceId) {
    parts.push(sql`EXISTS (
      SELECT 1 FROM sources s_direct
      WHERE s_direct.id = ${directSourceId}
        AND s_direct.slug IN (${valueList(slugs)})
    )`)
  }
  return sql`(${sql.join(parts, sql` OR `)})`
}

function externalKindCondition(
  refs: readonly RecordRefSql[],
  kinds: readonly string[],
): RawBuilder<unknown> | null {
  if (kinds.length === 0) return null
  return sql`(
    EXISTS (
      SELECT 1
      FROM external_identities ei_kind
      WHERE ${refPredicate(sql`ei_kind.entity_type`, sql`ei_kind.entity_id`, refs)}
        AND ei_kind.kind IN (${valueList(kinds)})
    )
    OR EXISTS (
      SELECT 1
      FROM record_provenance rp_kind
      JOIN external_identities ei_kind ON ei_kind.id = rp_kind.external_identity_id
      WHERE ${refPredicate(sql`rp_kind.record_type`, sql`rp_kind.record_id`, refs)}
        AND ei_kind.kind IN (${valueList(kinds)})
    )
  )`
}

function sourceIdentityCondition(
  refs: readonly RecordRefSql[],
  directSourceId?: RawBuilder<unknown>,
): RawBuilder<unknown> {
  const parts: RawBuilder<unknown>[] = [
    sql`EXISTS (
      SELECT 1 FROM record_provenance rp_any
      WHERE ${refPredicate(sql`rp_any.record_type`, sql`rp_any.record_id`, refs)}
        AND rp_any.source_id IS NOT NULL
    )`,
    sql`EXISTS (
      SELECT 1 FROM external_identities ei_any
      WHERE ${refPredicate(sql`ei_any.entity_type`, sql`ei_any.entity_id`, refs)}
    )`,
  ]
  if (directSourceId) parts.push(sql`${directSourceId} IS NOT NULL`)
  return sql`(${sql.join(parts, sql` OR `)})`
}

function applySourceClauses(
  clauses: RawBuilder<unknown>[],
  norm: NormalizedSearch,
  refs: readonly RecordRefSql[],
  directSourceId?: RawBuilder<unknown>,
): void {
  maybePush(clauses, sourceSlugCondition(refs, norm.sourceSlugs, directSourceId))
  maybePush(clauses, externalKindCondition(refs, norm.externalKinds))
  if (norm.has.sourceIdentity !== undefined) {
    const condition = sourceIdentityCondition(refs, directSourceId)
    clauses.push(norm.has.sourceIdentity ? condition : sql`NOT ${condition}`)
  }
}

function linkedDocumentClauses(norm: NormalizedSearch, documentId: RawBuilder<unknown>): RawBuilder<unknown>[] {
  const clauses: RawBuilder<unknown>[] = []
  if (norm.linked.people.length > 0) {
    clauses.push(sql`EXISTS (
      SELECT 1 FROM document_people dp_link
      WHERE dp_link.document_id = ${documentId}
        AND dp_link.person_id IN (${valueList(norm.linked.people)})
    )`)
  }
  if (norm.linked.organizations.length > 0) {
    clauses.push(sql`EXISTS (
      SELECT 1 FROM document_organizations do_link
      WHERE do_link.document_id = ${documentId}
        AND do_link.organization_id IN (${valueList(norm.linked.organizations)})
    )`)
  }
  if (norm.linked.projects.length > 0) {
    clauses.push(sql`EXISTS (
      SELECT 1 FROM project_documents pd_link
      WHERE pd_link.document_id = ${documentId}
        AND pd_link.project_id IN (${valueList(norm.linked.projects)})
    )`)
  }
  if (norm.linked.tasks.length > 0) {
    clauses.push(sql`EXISTS (
      SELECT 1 FROM task_documents td_link
      WHERE td_link.document_id = ${documentId}
        AND td_link.task_id IN (${valueList(norm.linked.tasks)})
    )`)
  }
  return clauses
}

function linkedInteractionClauses(
  norm: NormalizedSearch,
  interactionId: RawBuilder<unknown>,
): RawBuilder<unknown>[] {
  const clauses: RawBuilder<unknown>[] = []
  if (norm.linked.people.length > 0) {
    clauses.push(sql`EXISTS (
      SELECT 1 FROM interaction_participants ip_link
      WHERE ip_link.interaction_id = ${interactionId}
        AND ip_link.person_id IN (${valueList(norm.linked.people)})
    )`)
  }
  if (norm.linked.organizations.length > 0) {
    clauses.push(sql`EXISTS (
      SELECT 1 FROM interaction_organizations io_link
      WHERE io_link.interaction_id = ${interactionId}
        AND io_link.organization_id IN (${valueList(norm.linked.organizations)})
    )`)
  }
  if (norm.linked.projects.length > 0) {
    clauses.push(sql`EXISTS (
      SELECT 1 FROM project_interactions pi_link
      WHERE pi_link.interaction_id = ${interactionId}
        AND pi_link.project_id IN (${valueList(norm.linked.projects)})
    )`)
  }
  if (norm.linked.tasks.length > 0) {
    clauses.push(sql`EXISTS (
      SELECT 1 FROM task_interactions ti_link
      WHERE ti_link.interaction_id = ${interactionId}
        AND ti_link.task_id IN (${valueList(norm.linked.tasks)})
    )`)
  }
  return clauses
}

function linkedTaskClauses(norm: NormalizedSearch, taskId: RawBuilder<unknown>): RawBuilder<unknown>[] {
  const clauses: RawBuilder<unknown>[] = []
  if (norm.linked.people.length > 0) {
    clauses.push(sql`EXISTS (
      SELECT 1 FROM task_people tp_link
      WHERE tp_link.task_id = ${taskId}
        AND tp_link.person_id IN (${valueList(norm.linked.people)})
    )`)
  }
  if (norm.linked.organizations.length > 0) {
    clauses.push(sql`EXISTS (
      SELECT 1 FROM task_organizations to_link
      WHERE to_link.task_id = ${taskId}
        AND to_link.organization_id IN (${valueList(norm.linked.organizations)})
    )`)
  }
  if (norm.linked.projects.length > 0) {
    clauses.push(sql`t.project_id IN (${valueList(norm.linked.projects)})`)
  }
  if (norm.linked.tasks.length > 0) {
    clauses.push(sql`${taskId} IN (${valueList(norm.linked.tasks)})`)
  }
  return clauses
}

function hasTextCondition(recordType: FilteredSearchRecordType): RawBuilder<unknown> {
  if (recordType === 'document') {
    return sql`(
      (d.body_text IS NOT NULL AND trim(d.body_text) != '')
      OR EXISTS (SELECT 1 FROM content_chunks cc_text WHERE cc_text.record_type = 'document' AND cc_text.record_id = d.id)
    )`
  }
  if (recordType === 'interaction') {
    return sql`(
      (i.body_text IS NOT NULL AND trim(i.body_text) != '')
      OR EXISTS (SELECT 1 FROM content_chunks cc_text WHERE cc_text.record_type = 'interaction' AND cc_text.record_id = i.id)
    )`
  }
  if (recordType === 'interaction_transcript') return sql`trim(tr.raw_text) != ''`
  return sql`(
    trim(t.title) != ''
    OR (t.description IS NOT NULL AND trim(t.description) != '')
    OR EXISTS (SELECT 1 FROM content_chunks cc_text WHERE cc_text.record_type = 'task' AND cc_text.record_id = t.id)
  )`
}

function applyHasClauses(
  clauses: RawBuilder<unknown>[],
  norm: NormalizedSearch,
  recordType: FilteredSearchRecordType,
): void {
  if (norm.has.text !== undefined) {
    const condition = hasTextCondition(recordType)
    clauses.push(norm.has.text ? condition : sql`NOT ${condition}`)
  }

  if (norm.has.transcript === undefined) return
  if (recordType === 'interaction') {
    const condition = interactionHasTranscript(sql`i.id`)
    clauses.push(norm.has.transcript ? condition : sql`NOT ${condition}`)
  } else if (recordType === 'interaction_transcript') {
    if (!norm.has.transcript) clauses.push(sql`0 = 1`)
  } else if (norm.has.transcript) {
    clauses.push(sql`0 = 1`)
  }
}

function documentBranch(norm: NormalizedSearch): RawBuilder<unknown> {
  const clauses: RawBuilder<unknown>[] = [
    sql`d.archived_at IS NULL`,
    ...dateClauses(norm, 'document'),
    ...linkedDocumentClauses(norm, sql`d.id`),
  ]
  maybePush(clauses, inList(sql`d.kind`, norm.documentKinds))
  applyHasClauses(clauses, norm, 'document')
  applySourceClauses(clauses, norm, [{ recordType: 'document', recordId: sql`d.id` }])

  return sql`
    SELECT
      'document' AS "recordType",
      d.id AS "recordId",
      d.title AS "title",
      d.kind AS "kind",
      NULL AS "status",
      ${dateExpr('document', 'effective')} AS "date",
      d.created_at AS "createdAt",
      d.updated_at AS "updatedAt",
      NULL AS "parentRecordType",
      NULL AS "parentRecordId",
      NULL AS "parentTitle",
      0 AS "hasTranscript"
    FROM documents d
    WHERE 1 = 1 ${andClauses(clauses)}
  `
}

function interactionBranch(norm: NormalizedSearch): RawBuilder<unknown> {
  const clauses: RawBuilder<unknown>[] = [
    sql`i.archived_at IS NULL`,
    ...dateClauses(norm, 'interaction'),
    ...linkedInteractionClauses(norm, sql`i.id`),
  ]
  maybePush(clauses, inList(sql`i.kind`, norm.interactionKinds))
  applyHasClauses(clauses, norm, 'interaction')
  applySourceClauses(clauses, norm, [{ recordType: 'interaction', recordId: sql`i.id` }])

  return sql`
    SELECT
      'interaction' AS "recordType",
      i.id AS "recordId",
      i.title AS "title",
      i.kind AS "kind",
      NULL AS "status",
      ${dateExpr('interaction', 'effective')} AS "date",
      i.created_at AS "createdAt",
      i.updated_at AS "updatedAt",
      NULL AS "parentRecordType",
      NULL AS "parentRecordId",
      NULL AS "parentTitle",
      ${interactionHasTranscript(sql`i.id`)} AS "hasTranscript"
    FROM interactions i
    WHERE 1 = 1 ${andClauses(clauses)}
  `
}

function transcriptBranch(norm: NormalizedSearch): RawBuilder<unknown> {
  const clauses: RawBuilder<unknown>[] = [
    sql`parent_i.archived_at IS NULL`,
    ...dateClauses(norm, 'interaction_transcript'),
    ...linkedInteractionClauses(norm, sql`parent_i.id`),
  ]
  maybePush(clauses, inList(sql`parent_i.kind`, norm.interactionKinds))
  applyHasClauses(clauses, norm, 'interaction_transcript')
  applySourceClauses(
    clauses,
    norm,
    [
      { recordType: 'interaction_transcript', recordId: sql`tr.id` },
      { recordType: 'interaction', recordId: sql`parent_i.id` },
    ],
    sql`tr.source_id`,
  )

  return sql`
    SELECT
      'interaction_transcript' AS "recordType",
      tr.id AS "recordId",
      parent_i.title AS "title",
      parent_i.kind AS "kind",
      NULL AS "status",
      ${dateExpr('interaction_transcript', 'effective')} AS "date",
      tr.created_at AS "createdAt",
      tr.updated_at AS "updatedAt",
      'interaction' AS "parentRecordType",
      parent_i.id AS "parentRecordId",
      parent_i.title AS "parentTitle",
      1 AS "hasTranscript"
    FROM interaction_transcripts tr
    JOIN interactions parent_i ON parent_i.id = tr.interaction_id
    WHERE 1 = 1 ${andClauses(clauses)}
  `
}

function taskBranch(norm: NormalizedSearch): RawBuilder<unknown> {
  const clauses: RawBuilder<unknown>[] = [
    sql`t.archived_at IS NULL`,
    ...dateClauses(norm, 'task'),
    ...linkedTaskClauses(norm, sql`t.id`),
  ]
  maybePush(clauses, inList(sql`t.status`, norm.taskStatuses))
  applyHasClauses(clauses, norm, 'task')
  applySourceClauses(clauses, norm, [{ recordType: 'task', recordId: sql`t.id` }])

  return sql`
    SELECT
      'task' AS "recordType",
      t.id AS "recordId",
      t.title AS "title",
      NULL AS "kind",
      t.status AS "status",
      ${dateExpr('task', 'effective')} AS "date",
      t.created_at AS "createdAt",
      t.updated_at AS "updatedAt",
      NULL AS "parentRecordType",
      NULL AS "parentRecordId",
      NULL AS "parentTitle",
      0 AS "hasTranscript"
    FROM tasks t
    WHERE 1 = 1 ${andClauses(clauses)}
  `
}

function recordsCte(norm: NormalizedSearch): RawBuilder<unknown> {
  const branches: RawBuilder<unknown>[] = []
  if (wants(norm, 'document')) branches.push(documentBranch(norm))
  if (wants(norm, 'interaction')) branches.push(interactionBranch(norm))
  if (wants(norm, 'interaction_transcript')) branches.push(transcriptBranch(norm))
  if (wants(norm, 'task')) branches.push(taskBranch(norm))
  if (branches.length === 0) {
    return sql`
      SELECT
        NULL AS "recordType", NULL AS "recordId", NULL AS "title", NULL AS "kind",
        NULL AS "status", NULL AS "date", NULL AS "createdAt", NULL AS "updatedAt",
        NULL AS "parentRecordType", NULL AS "parentRecordId", NULL AS "parentTitle",
        0 AS "hasTranscript"
      WHERE 0 = 1
    `
  }
  return sql.join(branches, sql` UNION ALL `)
}

function metadataOrder(norm: NormalizedSearch): RawBuilder<unknown> {
  if (norm.sort === 'oldest') return sql`r."date" ASC, r."createdAt" ASC`
  if (norm.sort === 'updated') return sql`r."updatedAt" DESC, r."date" DESC`
  return sql`r."date" DESC, r."updatedAt" DESC`
}

function metadataRows(norm: NormalizedSearch): Promise<RecordRow[]> {
  return sql<RecordRow>`
    WITH records AS (${recordsCte(norm)})
    SELECT * FROM records r
    ORDER BY ${metadataOrder(norm)}
    LIMIT ${norm.limit}
  `
    .execute(db)
    .then((result) => result.rows)
}

function candidateLimit(norm: NormalizedSearch): number {
  return Math.min(MAX_KNN_CANDIDATES, Math.max(MIN_KNN_CANDIDATES, norm.limit * CANDIDATE_MULTIPLIER))
}

function lexicalChunkRows(norm: NormalizedSearch, match: string): Promise<CandidateRow[]> {
  return sql<CandidateRow>`
    WITH records AS (${recordsCte(norm)})
    SELECT
      r.*,
      cc.id AS "chunkId",
      cc.chunk_index AS "chunkIndex",
      snippet(content_chunks_fts, 0, '[', ']', '...', 12) AS "snippet",
      cc.text AS "text",
      bm25(content_chunks_fts) AS "bm25",
      NULL AS "semanticScore"
    FROM content_chunks_fts
    JOIN content_chunks cc ON cc.rowid = content_chunks_fts.rowid
    JOIN records r ON r."recordType" = cc.record_type AND r."recordId" = cc.record_id
    WHERE content_chunks_fts MATCH ${match}
    ORDER BY bm25(content_chunks_fts)
    LIMIT ${candidateLimit(norm)}
  `
    .execute(db)
    .then((result) => result.rows)
}

function directDocumentRows(norm: NormalizedSearch, match: string): Promise<CandidateRow[]> {
  if (!wants(norm, 'document')) return Promise.resolve([])
  return sql<CandidateRow>`
    WITH records AS (${recordsCte(norm)})
    SELECT
      r.*,
      NULL AS "chunkId",
      NULL AS "chunkIndex",
      COALESCE(
        NULLIF(snippet(documents_fts, 1, '[', ']', '...', 12), ''),
        NULLIF(snippet(documents_fts, 2, '[', ']', '...', 12), ''),
        NULLIF(snippet(documents_fts, 0, '[', ']', '...', 12), '')
      ) AS "snippet",
      d.body_text AS "text",
      bm25(documents_fts, 10.0, 1.0, 2.0) AS "bm25",
      NULL AS "semanticScore"
    FROM documents_fts
    JOIN documents d ON d.rowid = documents_fts.rowid
    JOIN records r ON r."recordType" = 'document' AND r."recordId" = d.id
    WHERE documents_fts MATCH ${match}
    ORDER BY bm25(documents_fts, 10.0, 1.0, 2.0)
    LIMIT ${candidateLimit(norm)}
  `
    .execute(db)
    .then((result) => result.rows)
}

function directInteractionRows(norm: NormalizedSearch, match: string): Promise<CandidateRow[]> {
  if (!wants(norm, 'interaction')) return Promise.resolve([])
  return sql<CandidateRow>`
    WITH records AS (${recordsCte(norm)})
    SELECT
      r.*,
      NULL AS "chunkId",
      NULL AS "chunkIndex",
      COALESCE(
        NULLIF(snippet(interactions_fts, 1, '[', ']', '...', 12), ''),
        NULLIF(snippet(interactions_fts, 2, '[', ']', '...', 12), ''),
        NULLIF(snippet(interactions_fts, 0, '[', ']', '...', 12), '')
      ) AS "snippet",
      i.body_text AS "text",
      bm25(interactions_fts, 10.0, 1.0, 2.0) AS "bm25",
      NULL AS "semanticScore"
    FROM interactions_fts
    JOIN interactions i ON i.rowid = interactions_fts.rowid
    JOIN records r ON r."recordType" = 'interaction' AND r."recordId" = i.id
    WHERE interactions_fts MATCH ${match}
    ORDER BY bm25(interactions_fts, 10.0, 1.0, 2.0)
    LIMIT ${candidateLimit(norm)}
  `
    .execute(db)
    .then((result) => result.rows)
}

function queryTerms(query: string): string[] {
  return query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

function taskLikeClause(query: string): RawBuilder<unknown> | null {
  const terms = queryTerms(query)
  if (terms.length === 0) return null
  const parts = terms.map((term) => {
    const like = toLikePattern(term)
    return like
      ? sql`(lower(t.title) LIKE ${like} ESCAPE '\\' OR lower(COALESCE(t.description, '')) LIKE ${like} ESCAPE '\\')`
      : null
  }).filter((part): part is RawBuilder<unknown> => part !== null)
  return parts.length > 0 ? sql`(${sql.join(parts, sql` OR `)})` : null
}

function directTaskRows(norm: NormalizedSearch, query: string): Promise<CandidateRow[]> {
  if (!wants(norm, 'task')) return Promise.resolve([])
  const like = taskLikeClause(query)
  if (!like) return Promise.resolve([])
  return sql<CandidateRow>`
    WITH records AS (${recordsCte(norm)})
    SELECT
      r.*,
      NULL AS "chunkId",
      NULL AS "chunkIndex",
      COALESCE(t.description, t.title) AS "snippet",
      COALESCE(t.description, t.title) AS "text",
      NULL AS "bm25",
      NULL AS "semanticScore"
    FROM tasks t
    JOIN records r ON r."recordType" = 'task' AND r."recordId" = t.id
    WHERE ${like}
    ORDER BY r."date" DESC, r."updatedAt" DESC
    LIMIT ${candidateLimit(norm)}
  `
    .execute(db)
    .then((result) => result.rows)
}

function semanticRows(norm: NormalizedSearch, vector: readonly number[]): Promise<CandidateRow[]> {
  const k = candidateLimit(norm)
  const vectorJson = JSON.stringify(Array.from(vector))
  return sql<CandidateRow>`
    WITH knn AS (
      SELECT rowid, distance
      FROM chunk_vectors
      WHERE embedding MATCH ${vectorJson} AND k = ${k}
    ),
    records AS (${recordsCte(norm)})
    SELECT
      r.*,
      cc.id AS "chunkId",
      cc.chunk_index AS "chunkIndex",
      cc.text AS "snippet",
      cc.text AS "text",
      NULL AS "bm25",
      1.0 - knn.distance AS "semanticScore"
    FROM knn
    JOIN chunk_embeddings ce ON ce.id = knn.rowid AND ce.model_id = ${EMBEDDING_MODEL_ID}
    JOIN content_chunks cc ON cc.id = ce.chunk_id
    JOIN records r ON r."recordType" = cc.record_type AND r."recordId" = cc.record_id
    WHERE knn.distance <= ${MAX_COSINE_DISTANCE}
    ORDER BY knn.distance
    LIMIT ${k}
  `
    .execute(db)
    .then((result) => result.rows)
}

function baseHitFromRow(row: RecordRow): BaseHit {
  const recordType = isFilteredRecordType(row.recordType) ? row.recordType : 'document'
  return {
    recordType,
    recordId: row.recordId,
    title: row.title ?? '(untitled)',
    kind: row.kind,
    status: row.status,
    date: row.date,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    parent:
      row.parentRecordType === 'interaction' && row.parentRecordId
        ? { recordType: 'interaction', recordId: row.parentRecordId, title: row.parentTitle }
        : null,
    hasTranscript: Boolean(Number(row.hasTranscript ?? 0)),
  }
}

function previewOf(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}...`
}

function candidateFromRow(row: CandidateRow, norm: NormalizedSearch): SearchCandidate {
  const record = baseHitFromRow(row)
  const lexical = row.bm25 === null || row.bm25 === undefined ? 0 : lexicalScore(Number(row.bm25))
  const semantic = row.semanticScore === null || row.semanticScore === undefined ? null : Number(row.semanticScore)
  const recency = recencyScore(row.date, norm.now)
  const score =
    semantic !== null && lexical === 0
      ? semantic
      : lexical > 0
        ? combineScore({ lexical, recency })
        : recency
  const text = row.text ? previewOf(row.text, norm.maxExcerptChars) : ''
  const snippet = row.snippet ? previewOf(row.snippet, 320) : text
  const excerpt =
    text || snippet
      ? {
          chunkId: row.chunkId,
          chunkIndex: row.chunkIndex,
          snippet,
          text: text || snippet,
          lexicalScore: lexical,
          semanticScore: semantic,
        }
      : null
  const rankKey = row.chunkId ?? `${record.recordType}:${record.recordId}:${row.snippet ?? ''}`
  return { record, excerpt, score, lexicalScore: lexical, semanticScore: semantic, rankKey }
}

function mergeCandidates(lists: readonly SearchCandidate[][], norm: NormalizedSearch): SearchCandidate[] {
  if (lists.length === 1) return lists[0] ?? []
  const merged = new Map<string, SearchCandidate & { rrf: number }>()
  for (const list of lists) {
    list.forEach((candidate, index) => {
      const contribution = 1 / (60 + index + 1)
      const existing = merged.get(candidate.rankKey)
      if (existing) {
        existing.rrf += contribution
        existing.score = Math.max(existing.score, candidate.score)
        existing.lexicalScore = Math.max(existing.lexicalScore, candidate.lexicalScore)
        existing.semanticScore = Math.max(existing.semanticScore ?? 0, candidate.semanticScore ?? 0) || null
        if (existing.excerpt && candidate.excerpt && existing.excerpt.lexicalScore === 0 && candidate.excerpt.lexicalScore > 0) {
          existing.excerpt = candidate.excerpt
        }
      } else {
        merged.set(candidate.rankKey, { ...candidate, rrf: contribution })
      }
    })
  }
  return [...merged.values()]
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, candidateLimit(norm))
    .map(({ rrf: _rrf, ...candidate }) => ({ ...candidate, score: _rrf }))
}

interface HitAccumulator {
  hit: FilteredSearchHit
  excerpts: FilteredSearchExcerpt[]
}

function groupCandidates(candidates: readonly SearchCandidate[], norm: NormalizedSearch): HitAccumulator[] {
  const byRecord = new Map<string, HitAccumulator>()
  for (const candidate of candidates) {
    const key = `${candidate.record.recordType}:${candidate.record.recordId}`
    const existing = byRecord.get(key)
    if (existing) {
      existing.hit.score = Math.max(existing.hit.score, candidate.score)
      existing.hit.lexicalScore = Math.max(existing.hit.lexicalScore, candidate.lexicalScore)
      existing.hit.semanticScore = Math.max(existing.hit.semanticScore ?? 0, candidate.semanticScore ?? 0) || null
      if (candidate.excerpt && existing.excerpts.length < norm.excerptsPerRecord) {
        existing.excerpts.push(candidate.excerpt)
      }
    } else {
      byRecord.set(key, {
        hit: {
          ...candidate.record,
          sourceSlugs: [],
          externalKinds: [],
          score: candidate.score,
          lexicalScore: candidate.lexicalScore,
          semanticScore: candidate.semanticScore,
          excerpts: [],
        },
        excerpts: candidate.excerpt ? [candidate.excerpt] : [],
      })
    }
  }
  return sortGrouped([...byRecord.values()], norm).slice(0, norm.limit)
}

function sortGrouped(groups: HitAccumulator[], norm: NormalizedSearch): HitAccumulator[] {
  const time = (value: string | null): number => (value ? Date.parse(value) || 0 : 0)
  if (norm.sort === 'oldest') {
    return groups.sort((a, b) => time(a.hit.date) - time(b.hit.date))
  }
  if (norm.sort === 'updated') {
    return groups.sort((a, b) => time(b.hit.updatedAt) - time(a.hit.updatedAt))
  }
  if (norm.sort === 'recent' || !norm.query) {
    return groups.sort((a, b) => time(b.hit.date) - time(a.hit.date))
  }
  return groups.sort((a, b) => b.hit.score - a.hit.score)
}

function refsForHit(hit: Pick<FilteredSearchHit, 'recordType' | 'recordId' | 'parent'>): Array<{ type: string; id: string }> {
  const refs = [{ type: hit.recordType, id: hit.recordId }]
  if (hit.parent) refs.push({ type: hit.parent.recordType, id: hit.parent.recordId })
  return refs
}

function refWhere(
  typeExpr: RawBuilder<unknown>,
  idExpr: RawBuilder<unknown>,
  refs: readonly { type: string; id: string }[],
): RawBuilder<unknown> {
  return sql`(${sql.join(
    refs.map((ref) => sql`(${typeExpr} = ${ref.type} AND ${idExpr} = ${ref.id})`),
    sql` OR `,
  )})`
}

async function sourceMetaFor(hit: Pick<FilteredSearchHit, 'recordType' | 'recordId' | 'parent'>): Promise<SourceMeta> {
  const refs = refsForHit(hit)
  const transcriptSource =
    hit.recordType === 'interaction_transcript'
      ? sql`UNION SELECT s.slug AS "value"
             FROM interaction_transcripts tr
             JOIN sources s ON s.id = tr.source_id
             WHERE tr.id = ${hit.recordId}`
      : sql``
  const sourceRows = await sql<{ value: string }>`
    SELECT DISTINCT value FROM (
      SELECT s.slug AS "value"
      FROM record_provenance rp
      JOIN sources s ON s.id = rp.source_id
      WHERE ${refWhere(sql`rp.record_type`, sql`rp.record_id`, refs)}
      UNION
      SELECT s.slug AS "value"
      FROM external_identities ei
      JOIN sources s ON s.id = ei.source_id
      WHERE ${refWhere(sql`ei.entity_type`, sql`ei.entity_id`, refs)}
      ${transcriptSource}
    )
    WHERE value IS NOT NULL
    ORDER BY value ASC
  `.execute(db)

  const externalRows = await sql<{ value: string }>`
    SELECT DISTINCT value FROM (
      SELECT ei.kind AS "value"
      FROM external_identities ei
      WHERE ${refWhere(sql`ei.entity_type`, sql`ei.entity_id`, refs)}
      UNION
      SELECT ei.kind AS "value"
      FROM record_provenance rp
      JOIN external_identities ei ON ei.id = rp.external_identity_id
      WHERE ${refWhere(sql`rp.record_type`, sql`rp.record_id`, refs)}
    )
    WHERE value IS NOT NULL
    ORDER BY value ASC
  `.execute(db)

  return {
    sourceSlugs: sourceRows.rows.map((row) => row.value),
    externalKinds: externalRows.rows.map((row) => row.value),
  }
}

interface ChunkExcerptRow {
  chunkId: string
  chunkIndex: number
  text: string
}

type ExcerptRecordRef = Pick<BaseHit, 'recordType' | 'recordId'>

async function chunkExcerptsFor(hit: ExcerptRecordRef, norm: NormalizedSearch): Promise<FilteredSearchExcerpt[]> {
  const rows = await db
    .selectFrom('contentChunks')
    .where('recordType', '=', hit.recordType)
    .where('recordId', '=', hit.recordId)
    .orderBy('chunkIndex', 'asc')
    .limit(norm.excerptsPerRecord)
    .select(['id as chunkId', 'chunkIndex', 'text'])
    .execute() as ChunkExcerptRow[]
  return rows.map((row) => {
    const text = previewOf(row.text, norm.maxExcerptChars)
    return {
      chunkId: row.chunkId,
      chunkIndex: row.chunkIndex,
      snippet: previewOf(row.text, 320),
      text,
      lexicalScore: 0,
      semanticScore: null,
    }
  })
}

async function bodyFallbackFor(hit: ExcerptRecordRef, norm: NormalizedSearch): Promise<FilteredSearchExcerpt[]> {
  let text: string | null | undefined
  if (hit.recordType === 'document') {
    const row = await db.selectFrom('documents').select('bodyText').where('id', '=', hit.recordId).executeTakeFirst()
    text = row?.bodyText
  } else if (hit.recordType === 'interaction') {
    const row = await db.selectFrom('interactions').select('bodyText').where('id', '=', hit.recordId).executeTakeFirst()
    text = row?.bodyText
  } else if (hit.recordType === 'interaction_transcript') {
    const row = await db.selectFrom('interactionTranscripts').select('rawText').where('id', '=', hit.recordId).executeTakeFirst()
    text = row?.rawText
  } else {
    const row = await db
      .selectFrom('tasks')
      .select(['title', 'description'])
      .where('id', '=', hit.recordId)
      .executeTakeFirst()
    text = row?.description ?? row?.title
  }
  if (!text?.trim()) return []
  return [{
    chunkId: null,
    chunkIndex: null,
    snippet: previewOf(text, 320),
    text: previewOf(text, norm.maxExcerptChars),
    lexicalScore: 0,
    semanticScore: null,
  }]
}

async function ensureExcerpts(hit: ExcerptRecordRef, existing: FilteredSearchExcerpt[], norm: NormalizedSearch): Promise<FilteredSearchExcerpt[]> {
  if (existing.length >= norm.excerptsPerRecord) return existing.slice(0, norm.excerptsPerRecord)
  const seen = new Set(existing.map((excerpt) => excerpt.chunkId ?? excerpt.text))
  const extras = [...(await chunkExcerptsFor(hit, norm)), ...(await bodyFallbackFor(hit, norm))]
    .filter((excerpt) => {
      const key = excerpt.chunkId ?? excerpt.text
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  return [...existing, ...extras].slice(0, norm.excerptsPerRecord)
}

async function hydrateHits(groups: readonly HitAccumulator[], norm: NormalizedSearch): Promise<FilteredSearchHit[]> {
  return Promise.all(groups.map(async (group) => {
    const meta = await sourceMetaFor(group.hit)
    const excerpts = await ensureExcerpts(group.hit, group.excerpts, norm)
    return {
      ...group.hit,
      sourceSlugs: meta.sourceSlugs,
      externalKinds: meta.externalKinds,
      excerpts,
    }
  }))
}

function metadataCandidates(rows: readonly RecordRow[], norm: NormalizedSearch): SearchCandidate[] {
  return rows.map((row, index) => {
    const record = baseHitFromRow(row)
    const recency = recencyScore(record.date, norm.now)
    return {
      record,
      excerpt: null,
      score: recency,
      lexicalScore: 0,
      semanticScore: null,
      rankKey: `${record.recordType}:${record.recordId}:${index}`,
    }
  })
}

async function lexicalCandidates(norm: NormalizedSearch): Promise<SearchCandidate[]> {
  if (!norm.query) return []
  const match = toMatchQuery(norm.query, { op: 'or' })
  if (!match) return []
  const rows = await Promise.all([
    lexicalChunkRows(norm, match),
    directDocumentRows(norm, match),
    directInteractionRows(norm, match),
    directTaskRows(norm, norm.query),
  ])
  return rows
    .flat()
    .map((row) => candidateFromRow(row, norm))
    .sort((a, b) => b.score - a.score)
}

async function semanticCandidates(norm: NormalizedSearch): Promise<{ semanticAvailable: boolean; candidates: SearchCandidate[] }> {
  if (!norm.query || norm.mode === 'lexical') return { semanticAvailable: false, candidates: [] }
  try {
    const enabled = await isEmbeddingsEnabled()
    if (!enabled) return { semanticAvailable: false, candidates: [] }
    const status = await embedStatus()
    if (!isEmbedReady(status)) return { semanticAvailable: false, candidates: [] }
    const [vector] = await embedTexts([norm.query])
    if (!vector || vector.length === 0) return { semanticAvailable: false, candidates: [] }
    const rows = await semanticRows(norm, vector)
    const candidates = rows.map((row) => candidateFromRow(row, norm)).sort((a, b) => b.score - a.score)
    return { semanticAvailable: candidates.length > 0, candidates }
  } catch {
    return { semanticAvailable: false, candidates: [] }
  }
}

/**
 * Search records by optional text plus structured filters. Hybrid mode uses
 * semantic chunks when available and degrades to lexical/metadata search.
 */
export async function filteredSearch(
  input: FilteredSearchInput,
  options: FilteredSearchOptions = {},
): Promise<FilteredSearchResult> {
  const norm = normalizeSearch(input, options)
  if (!norm.query) {
    const rows = await metadataRows(norm)
    const groups = groupCandidates(metadataCandidates(rows, norm), norm)
    const hits = await hydrateHits(groups, norm)
    return { query: null, mode: norm.mode, semanticAvailable: false, hits, count: hits.length }
  }

  const lexical = await lexicalCandidates(norm)
  const semantic = await semanticCandidates(norm)
  const candidateLists =
    norm.mode === 'semantic' && semantic.candidates.length > 0
      ? [semantic.candidates, lexical]
      : semantic.candidates.length > 0 && norm.mode === 'hybrid'
        ? [lexical, semantic.candidates]
        : [lexical]
  const merged = mergeCandidates(candidateLists, norm)
  const groups = groupCandidates(merged, norm)
  const hits = await hydrateHits(groups, norm)
  return {
    query: norm.query,
    mode: norm.mode,
    semanticAvailable: semantic.semanticAvailable,
    hits,
    count: hits.length,
  }
}

export const FILTERED_SEARCH_RECORD_TYPES: readonly FilteredSearchRecordType[] = FILTERED_RECORD_TYPES
export type FilteredSearchSourceRecordType = Extract<SourceRecordType, FilteredSearchRecordType>
