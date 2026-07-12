import { sql } from 'kysely'
import { db } from '../db/client'
import { embedStatus, embedTexts } from '../embeddings/commands'
import { isEmbedReady } from '../embeddings/model'
import { semanticHits } from '../embeddings/semantic'
import { isEmbeddingsEnabled } from '../embeddings/status'
import {
  chunkFilterClauses,
  chunkNavigationRecordId,
  chunkNavigationRecordType,
  chunkRecordDate,
  chunkRecordJoins,
  chunkRecordTitle,
  chunkVisibilityFilter,
  type ChunkFilters,
} from './chunk-sources'
import { toMatchQuery } from './match-query'
import { searchDirectRecordCandidates } from './record-candidate-direct'
import {
  candidateKey,
  candidateRecordTime,
  newInternalCandidate,
  type InternalCandidate,
  type NavigableRecordType,
  type RecordCandidate,
  type RecordCandidateSearchOptions,
  type RecordCandidateSearchResult,
} from './record-candidate-types'
import { relatedRecordKeys } from './related-records'
import type { SortMode, SourceRecordType } from './retrieve'

export type {
  RecordCandidate,
  RecordCandidateEvidence,
  RecordCandidateSearchOptions,
  RecordCandidateSearchResult,
} from './record-candidate-types'

interface ChunkRow {
  chunkId: string
  text: string
  snippet: string | null
  recordType: SourceRecordType
  recordId: string
  recordTitle: string | null
  recordDate: string | null
  navigationRecordType?: NavigableRecordType | null
  navigationRecordId?: string | null
  chunkIndex: number
  bm25: number
}

const DEFAULT_LIMIT = 12
const CANDIDATE_MULTIPLIER = 4
const MAX_EVIDENCE = 2
const RRF_K = 60

function buildChunkFilters(
  options: RecordCandidateSearchOptions,
  allowed: ReadonlySet<string> | undefined,
): ChunkFilters {
  const recordTypes = options.recordTypes ?? (options.recordType ? [options.recordType] : undefined)
  return {
    ...(recordTypes?.length ? { recordTypes } : {}),
    ...(options.kinds?.length ? { kinds: options.kinds } : {}),
    ...(options.after ? { after: options.after } : {}),
    ...(options.before ? { before: options.before } : {}),
    ...(allowed ? { recordKeys: [...allowed] } : {}),
  }
}

function preview(text: string, max = 240): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`
}

function collapseChunkHits(
  hits: readonly Omit<ChunkRow, 'bm25'>[],
  reason: 'chunk_lexical' | 'chunk_semantic' | 'recent',
): InternalCandidate[] {
  const candidates = new Map<string, InternalCandidate>()
  for (const hit of hits) {
    const key = `${hit.recordType}:${hit.recordId}`
    let candidate = candidates.get(key)
    if (!candidate) {
      const navigation = hit.navigationRecordType && hit.navigationRecordId
        ? { recordType: hit.navigationRecordType, recordId: hit.navigationRecordId }
        : null
      candidate = newInternalCandidate(
        hit.recordType,
        hit.recordId,
        hit.recordTitle,
        hit.recordDate,
        [reason],
        navigation,
      )
      candidates.set(key, candidate)
    }
    if (candidate.evidence.length < MAX_EVIDENCE && !candidate.evidence.some((item) => item.chunkId === hit.chunkId)) {
      candidate.evidence.push({
        chunkId: hit.chunkId,
        chunkIndex: Number(hit.chunkIndex),
        snippet: hit.snippet ?? preview(hit.text),
      })
    }
  }
  return [...candidates.values()]
}

async function lexicalChunkCandidates(
  match: string,
  filters: ChunkFilters,
  sort: SortMode,
  limit: number,
): Promise<InternalCandidate[]> {
  const bestOrder = sort === 'recency' ? sql`MAX("recordDate") DESC` : sql`MIN(bm25) ASC`
  const outerOrder = sort === 'recency'
    ? sql`selected.bestRecordDate DESC, selected.bm25`
    : sql`selected.bestBm25, selected.bm25`
  const result = await sql<ChunkRow>`
    WITH matching AS MATERIALIZED (
      SELECT
        cc.id AS "chunkId",
        cc.text AS "text",
        snippet(content_chunks_fts, 0, '[', ']', '…', 12) AS "snippet",
        cc.record_type AS "recordType",
        cc.record_id AS "recordId",
        cc.chunk_index AS "chunkIndex",
        ${chunkRecordTitle} AS "recordTitle",
        ${chunkRecordDate} AS "recordDate",
        ${chunkNavigationRecordType} AS "navigationRecordType",
        ${chunkNavigationRecordId} AS "navigationRecordId",
        bm25(content_chunks_fts) AS bm25
      FROM content_chunks_fts
      JOIN content_chunks cc ON cc.rowid = content_chunks_fts.rowid
      ${chunkRecordJoins}
      WHERE content_chunks_fts MATCH ${match}
        AND ${chunkVisibilityFilter}
        ${chunkFilterClauses(filters)}
    ), best AS (
      SELECT "recordType", "recordId", MIN(bm25) AS bestBm25, MAX("recordDate") AS "recordDate"
      FROM matching
      GROUP BY "recordType", "recordId"
      ORDER BY ${bestOrder}
      LIMIT ${limit}
    ), selected AS (
      SELECT matching.*, best.bestBm25, best."recordDate" AS bestRecordDate,
        ROW_NUMBER() OVER (
          PARTITION BY matching."recordType", matching."recordId"
          ORDER BY matching.bm25
        ) AS evidenceRank
      FROM matching
      JOIN best USING ("recordType", "recordId")
    )
    SELECT selected.*
    FROM selected
    WHERE selected.evidenceRank <= ${MAX_EVIDENCE}
    ORDER BY ${outerOrder}
  `.execute(db)
  return collapseChunkHits(result.rows, 'chunk_lexical')
}

async function browseChunkCandidates(filters: ChunkFilters, limit: number): Promise<InternalCandidate[]> {
  const result = await sql<ChunkRow>`
    WITH first_chunks AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY record_type, record_id ORDER BY chunk_index) AS rn
      FROM content_chunks
    )
    SELECT
      cc.id AS "chunkId",
      cc.text AS "text",
      cc.text AS "snippet",
      cc.record_type AS "recordType",
      cc.record_id AS "recordId",
      cc.chunk_index AS "chunkIndex",
      ${chunkRecordTitle} AS "recordTitle",
      ${chunkRecordDate} AS "recordDate",
      ${chunkNavigationRecordType} AS "navigationRecordType",
      ${chunkNavigationRecordId} AS "navigationRecordId",
      0 AS bm25
    FROM first_chunks cc
    ${chunkRecordJoins}
    WHERE cc.rn = 1
      AND ${chunkVisibilityFilter}
      ${chunkFilterClauses(filters)}
    ORDER BY ${chunkRecordDate} DESC
    LIMIT ${limit}
  `.execute(db)
  return collapseChunkHits(result.rows, 'recent')
}

async function semanticChunkCandidates(
  query: string,
  filters: ChunkFilters,
  limit: number,
): Promise<InternalCandidate[] | null> {
  try {
    if (!(await isEmbeddingsEnabled())) return null
    const status = await embedStatus()
    if (!isEmbedReady(status)) return null
    const [vector] = await embedTexts([query])
    if (!vector?.length) return null
    const hits = await semanticHits(vector, {
      limit: limit * 2,
      filters,
      minUniqueRecords: limit,
      maxChunksPerRecord: MAX_EVIDENCE,
    })
    if (hits.length === 0) return null
    return collapseChunkHits(hits, 'chunk_semantic').slice(0, limit)
  } catch {
    return null
  }
}

function mergeCandidate(existing: InternalCandidate, incoming: InternalCandidate): void {
  existing.title ??= incoming.title
  existing.date ??= incoming.date
  existing.navigationRecordType ??= incoming.navigationRecordType
  existing.navigationRecordId ??= incoming.navigationRecordId
  existing.exactTitle ||= incoming.exactTitle
  existing.quality = Math.min(existing.quality, incoming.quality)
  existing.termMatches = Math.max(existing.termMatches, incoming.termMatches)
  existing.matchReasons = [...new Set([...existing.matchReasons, ...incoming.matchReasons])]
  for (const evidence of incoming.evidence) {
    if (existing.evidence.length >= MAX_EVIDENCE) break
    if (!existing.evidence.some((item) => item.chunkId === evidence.chunkId)) existing.evidence.push(evidence)
  }
}

function fuseRecordLists(lists: readonly InternalCandidate[][], sort: SortMode): RecordCandidate[] {
  const fused = new Map<string, { candidate: InternalCandidate; score: number }>()
  for (const list of lists) {
    list.forEach((candidate, index) => {
      const key = candidateKey(candidate)
      const existing = fused.get(key)
      if (existing) {
        existing.score += 1 / (RRF_K + index + 1)
        mergeCandidate(existing.candidate, candidate)
      } else {
        fused.set(key, { candidate: { ...candidate, evidence: [...candidate.evidence] }, score: 1 / (RRF_K + index + 1) })
      }
    })
  }
  const ranked = [...fused.values()].sort((a, b) => {
    if (sort === 'recency') {
      return candidateRecordTime(b.candidate.date) - candidateRecordTime(a.candidate.date) || b.score - a.score
    }
    return (
      Number(b.candidate.exactTitle) - Number(a.candidate.exactTitle) ||
      b.score - a.score ||
      candidateRecordTime(b.candidate.date) - candidateRecordTime(a.candidate.date)
    )
  })
  return ranked.map(({ candidate: { exactTitle: _exact, quality: _quality, termMatches: _terms, ...candidate } }) => candidate)
}

function hasStructuralFilters(options: RecordCandidateSearchOptions): boolean {
  return Boolean(
    options.recordType ||
      options.recordTypes?.length ||
      options.kinds?.length ||
      options.after ||
      options.before ||
      options.relatedTo?.length,
  )
}

function filterRelated(
  list: InternalCandidate[],
  allowed: ReadonlySet<string> | undefined,
): InternalCandidate[] {
  if (!allowed) return list
  return list
    .filter((candidate) => allowed.has(candidateKey(candidate)))
    .map((candidate) => ({
      ...candidate,
      matchReasons: [...new Set([...candidate.matchReasons, 'related'])],
    }))
}

/**
 * Search at record granularity for grounded Chat and other agent workflows.
 * Direct names/titles/summaries/typed fields and chunk lexical/semantic signals
 * are ranked independently, collapsed to unique records, then combined with
 * scale-free RRF. Recency is a tie-break (or the explicit chronological sort),
 * never an absolute number mixed with SQLite's corpus-dependent BM25 scale.
 */
export async function searchRecordCandidates(
  query: string,
  options: RecordCandidateSearchOptions = {},
): Promise<RecordCandidateSearchResult> {
  const mode = options.mode ?? 'hybrid'
  const sort = options.sort ?? 'relevance'
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT)
  const candidateLimit = limit * CANDIDATE_MULTIPLIER
  const match = toMatchQuery(query, { op: 'or' })
  if (!match && !hasStructuralFilters(options)) {
    return { query, mode, semanticAvailable: false, candidates: [] }
  }

  // Resolve relationship ids before any text query applies its LIMIT. Filtering
  // a capped global result afterwards can miss the one older/selective related
  // record behind a page of newer unrelated matches.
  const allowed = await relatedRecordKeys(options.relatedTo)
  if (allowed?.size === 0) {
    return { query, mode, semanticAvailable: false, candidates: [] }
  }
  const filters = buildChunkFilters(options, allowed)
  const directPromise = searchDirectRecordCandidates(query, options, allowed, candidateLimit)
  const lexicalPromise = match
    ? lexicalChunkCandidates(match, filters, sort, candidateLimit)
    : browseChunkCandidates(filters, candidateLimit)
  const semanticPromise = match && mode !== 'lexical' && sort !== 'recency'
    ? semanticChunkCandidates(query, filters, candidateLimit)
    : Promise.resolve(null)
  // The direct, FTS, and embedding legs are independent once relation ids have
  // been resolved. Run them concurrently to keep Chat latency near the slowest
  // leg rather than the sum of all three.
  const [direct, lexical, semantic] = await Promise.all([
    directPromise,
    lexicalPromise,
    semanticPromise,
  ])
  const semanticAvailable = Boolean(semantic?.length)
  const lexicalNeeded = mode !== 'semantic' || !semanticAvailable || !match
  const lists = [
    filterRelated(direct, allowed),
    ...(lexicalNeeded ? [filterRelated(lexical, allowed)] : []),
    ...(semantic ? [filterRelated(semantic, allowed)] : []),
  ]

  return {
    query,
    mode,
    semanticAvailable,
    candidates: fuseRecordLists(lists, sort).slice(0, limit),
  }
}
