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
import {
  candidateQueryTerms,
  hasQuantitativeIntent,
  normalizedEvidenceText,
  selectCandidateEvidence,
  type CandidateEvidenceHit,
} from './record-candidate-evidence'
import { searchDirectRecordCandidates } from './record-candidate-direct'
import {
  candidateKey,
  candidateRecordTime,
  newInternalCandidate,
  type InternalCandidate,
  type RecordCandidate,
  type RecordCandidateSearchOptions,
  type RecordCandidateSearchResult,
} from './record-candidate-types'
import { relatedRecordKeys } from './related-records'
import type { SortMode } from './retrieve'

export type {
  RecordCandidate,
  RecordCandidateEvidence,
  RecordCandidateSearchOptions,
  RecordCandidateSearchResult,
} from './record-candidate-types'

interface ChunkRow extends CandidateEvidenceHit {
  contentHash: string | null
  bm25: number
  termMatches: number
  answerStrength: number
}

const DEFAULT_LIMIT = 12
const CANDIDATE_MULTIPLIER = 4
const MAX_EVIDENCE = 2
const LEXICAL_EVIDENCE_POOL_SIZE = 4
const SEMANTIC_EVIDENCE_POOL_SIZE = 4
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

function quantitativePreview(
  text: string,
  valueStart: number | null,
  valueEnd: number | null,
  max = 320,
): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  if (valueStart === null || valueEnd === null) return preview(trimmed, max)
  const center = Math.floor((valueStart + valueEnd) / 2)
  const start = Math.max(0, Math.min(text.length - max, center - Math.floor(max / 2)))
  const end = Math.min(text.length, start + max)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

function scoreCandidateEvidence(candidate: InternalCandidate, query: string): void {
  const selected = selectCandidateEvidence(candidate.evidencePool, query, MAX_EVIDENCE)
  const evidenceTerms = selected.flatMap((item) => item.matchedTerms)
  candidate.matchedTerms = [...new Set([...candidate.fieldMatchedTerms, ...evidenceTerms])]
  candidate.termMatches = candidate.matchedTerms.length
  candidate.answerStrength = Math.max(0, ...selected.map((item) => item.answerStrength))
  candidate.evidence = selected.map(({
    hit,
    answerStrength,
    answerValueStart,
    answerValueEnd,
  }) => ({
    chunkId: hit.chunkId,
    chunkIndex: Number(hit.chunkIndex),
    snippet: answerStrength > 0
      ? quantitativePreview(hit.text, answerValueStart, answerValueEnd)
      : (hit.snippet ?? preview(hit.text)),
  }))
}

function collapseChunkHits(
  hits: readonly CandidateEvidenceHit[],
  reason: 'chunk_lexical' | 'chunk_semantic' | 'recent',
  query = '',
): InternalCandidate[] {
  const grouped = new Map<string, CandidateEvidenceHit[]>()
  for (const hit of hits) {
    const key = `${hit.recordType}:${hit.recordId}`
    const recordHits = grouped.get(key) ?? []
    recordHits.push(hit)
    grouped.set(key, recordHits)
  }

  return [...grouped.values()].map((recordHits) => {
    const first = recordHits[0]!
    const navigation = first.navigationRecordType && first.navigationRecordId
      ? { recordType: first.navigationRecordType, recordId: first.navigationRecordId }
      : null
    const candidate = newInternalCandidate(
      first.recordType,
      first.recordId,
      first.recordTitle,
      first.recordDate,
      [reason],
      navigation,
    )
    const titleTokens = new Set(
      normalizedEvidenceText(first.recordTitle ?? '').match(/[\p{L}\p{N}]+/gu) ?? [],
    )
    candidate.fieldMatchedTerms = candidateQueryTerms(query).filter((term) => titleTokens.has(term))
    candidate.evidencePool = [...recordHits]
    scoreCandidateEvidence(candidate, query)
    return candidate
  })
}

async function lexicalChunkCandidates(
  query: string,
  match: string,
  filters: ChunkFilters,
  sort: SortMode,
  limit: number,
): Promise<InternalCandidate[]> {
  const terms = candidateQueryTerms(query)
  const quantitativeIntent = hasQuantitativeIntent(query, terms)
  const termMatches = terms.length > 0
    ? sql<number>`(${sql.join(
        terms.map((term) => sql`CASE WHEN cc.rowid IN (
          SELECT token_hits.rowid
          FROM content_chunks_fts AS token_hits
          WHERE content_chunks_fts MATCH ${`"${term}"`}
        ) THEN 1 ELSE 0 END`),
        sql` + `,
      )})`
    : sql<number>`0`
  const answerMatch = quantitativeIntent
    ? sql<number>`CASE
        WHEN cc.text GLOB '*[0-9]*%*'
          OR ((instr(cc.text, '$') > 0 OR instr(cc.text, '£') > 0 OR instr(cc.text, '€') > 0)
            AND cc.text GLOB '*[0-9]*') THEN 3
        WHEN cc.text GLOB '*[0-9]*.[0-9]*' THEN 2
        WHEN cc.text GLOB '*[0-9]*' THEN 1
        ELSE 0
      END`
    : sql<number>`0`
  const evidenceScore = sql<number>`((${termMatches}) * 3 + (${answerMatch}) * 2)`
  const normalizedContent = sql<string>`lower(trim(replace(replace(replace(replace(replace(
    cc.text, char(13), ' '), char(10), ' '), char(9), ' '), '  ', ' '), '  ', ' ')))`
  const bestOrder = sort === 'recency'
    ? sql`MAX("recordDate") DESC`
    : sql`MAX("evidenceScore") DESC, MAX("termMatches") DESC, MIN(bm25) ASC`
  const outerOrder = sort === 'recency'
    ? sql`selected.bestRecordDate DESC, selected.bm25`
    : sql`selected.bestEvidenceScore DESC, selected.bestTermMatches DESC,
        selected."evidenceScore" DESC, selected.bm25`
  const result = await sql<ChunkRow>`
    WITH matching AS MATERIALIZED (
      SELECT
        cc.id AS "chunkId",
        cc.text AS "text",
        cc.content_hash AS "contentHash",
        COALESCE(NULLIF(cc.content_hash, ''), NULLIF(${normalizedContent}, ''), cc.id) AS "evidenceKey",
        snippet(content_chunks_fts, 0, '[', ']', '…', 12) AS "snippet",
        cc.record_type AS "recordType",
        cc.record_id AS "recordId",
        cc.chunk_index AS "chunkIndex",
        ${chunkRecordTitle} AS "recordTitle",
        ${chunkRecordDate} AS "recordDate",
        ${chunkNavigationRecordType} AS "navigationRecordType",
        ${chunkNavigationRecordId} AS "navigationRecordId",
        ${termMatches} AS "termMatches",
        ${answerMatch} AS "answerStrength",
        ${evidenceScore} AS "evidenceScore",
        bm25(content_chunks_fts) AS bm25
      FROM content_chunks_fts
      JOIN content_chunks cc ON cc.rowid = content_chunks_fts.rowid
      ${chunkRecordJoins}
      WHERE content_chunks_fts MATCH ${match}
        AND ${chunkVisibilityFilter}
        ${chunkFilterClauses(filters)}
    ), deduplicated AS (
      SELECT matching.*, ROW_NUMBER() OVER (
        PARTITION BY "recordType", "recordId", "evidenceKey"
        ORDER BY "evidenceScore" DESC, "answerStrength" DESC, "termMatches" DESC, bm25, "chunkIndex"
      ) AS duplicateRank
      FROM matching
    ), unique_matching AS MATERIALIZED (
      SELECT *
      FROM deduplicated
      WHERE duplicateRank = 1
    ), best AS (
      SELECT "recordType", "recordId", MAX("evidenceScore") AS bestEvidenceScore,
        MAX("termMatches") AS bestTermMatches,
        MAX("recordDate") AS "recordDate"
      FROM unique_matching
      GROUP BY "recordType", "recordId"
      ORDER BY ${bestOrder}
      LIMIT ${limit}
    ), selected AS (
      SELECT unique_matching.*, best.bestEvidenceScore, best.bestTermMatches,
        best."recordDate" AS bestRecordDate,
        ROW_NUMBER() OVER (
          PARTITION BY unique_matching."recordType", unique_matching."recordId"
          ORDER BY unique_matching."evidenceScore" DESC, unique_matching."answerStrength" DESC,
            unique_matching."termMatches" DESC, unique_matching.bm25, unique_matching."chunkIndex"
        ) AS evidenceRank
      FROM unique_matching
      JOIN best USING ("recordType", "recordId")
    )
    SELECT selected.*
    FROM selected
    WHERE selected.evidenceRank <= ${LEXICAL_EVIDENCE_POOL_SIZE}
    ORDER BY ${outerOrder}
  `.execute(db)
  return collapseChunkHits(result.rows, 'chunk_lexical', query)
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
      cc.content_hash AS "contentHash",
      cc.text AS "snippet",
      cc.record_type AS "recordType",
      cc.record_id AS "recordId",
      cc.chunk_index AS "chunkIndex",
      ${chunkRecordTitle} AS "recordTitle",
      ${chunkRecordDate} AS "recordDate",
      ${chunkNavigationRecordType} AS "navigationRecordType",
      ${chunkNavigationRecordId} AS "navigationRecordId",
      0 AS bm25,
      0 AS "termMatches",
      0 AS "answerStrength"
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
      maxChunksPerRecord: SEMANTIC_EVIDENCE_POOL_SIZE,
    })
    if (hits.length === 0) return null
    return collapseChunkHits(hits, 'chunk_semantic', query).slice(0, limit)
  } catch {
    return null
  }
}

function mergeCandidate(existing: InternalCandidate, incoming: InternalCandidate, query: string): void {
  existing.title ??= incoming.title
  existing.date ??= incoming.date
  existing.navigationRecordType ??= incoming.navigationRecordType
  existing.navigationRecordId ??= incoming.navigationRecordId
  existing.exactTitle ||= incoming.exactTitle
  existing.quality = Math.min(existing.quality, incoming.quality)
  existing.fieldMatchedTerms = [...new Set([
    ...existing.fieldMatchedTerms,
    ...incoming.fieldMatchedTerms,
  ])]
  existing.matchReasons = [...new Set([...existing.matchReasons, ...incoming.matchReasons])]
  for (const hit of incoming.evidencePool) {
    const normalized = normalizedEvidenceText(hit.text)
    if (!existing.evidencePool.some((item) => (
      item.chunkId === hit.chunkId ||
      (hit.contentHash && item.contentHash === hit.contentHash) ||
      normalizedEvidenceText(item.text) === normalized
    ))) {
      existing.evidencePool.push(hit)
    }
  }
  scoreCandidateEvidence(existing, query)
}

/** @internal Deterministic record fusion, exported for narrow regression tests. */
export function fuseRecordLists(
  lists: readonly InternalCandidate[][],
  sort: SortMode,
  query: string,
): RecordCandidate[] {
  const fused = new Map<string, { candidate: InternalCandidate; score: number }>()
  for (const list of lists) {
    list.forEach((candidate, index) => {
      const key = candidateKey(candidate)
      const existing = fused.get(key)
      if (existing) {
        existing.score += 1 / (RRF_K + index + 1)
        mergeCandidate(existing.candidate, candidate, query)
      } else {
        fused.set(key, {
          candidate: {
            ...candidate,
            evidence: [...candidate.evidence],
            evidencePool: candidate.evidencePool.map((hit) => ({ ...hit })),
            fieldMatchedTerms: [...candidate.fieldMatchedTerms],
            matchedTerms: [...candidate.matchedTerms],
          },
          score: 1 / (RRF_K + index + 1),
        })
      }
    })
  }
  const ranked = [...fused.values()].sort((a, b) => {
    if (sort === 'recency') {
      return candidateRecordTime(b.candidate.date) - candidateRecordTime(a.candidate.date) || b.score - a.score
    }
    return (
      Number(b.candidate.exactTitle) - Number(a.candidate.exactTitle) ||
      b.candidate.termMatches - a.candidate.termMatches ||
      b.candidate.answerStrength - a.candidate.answerStrength ||
      b.score - a.score ||
      candidateRecordTime(b.candidate.date) - candidateRecordTime(a.candidate.date)
    )
  })
  return ranked.map(({
    candidate: {
      exactTitle: _exact,
      quality: _quality,
      fieldMatchedTerms: _fieldMatchedTerms,
      matchedTerms: _matchedTerms,
      termMatches: _terms,
      answerStrength: _answerStrength,
      evidencePool: _evidencePool,
      ...candidate
    },
  }) => candidate)
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
  const terms = candidateQueryTerms(query)
  // Keep the raw query as a safe FTS fallback when normalization intentionally
  // removes every ranking term; structural browsing still handles empty input.
  const match = toMatchQuery(terms.length > 0 ? terms.join(' ') : query, { op: 'or' })
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
    ? lexicalChunkCandidates(query, match, filters, sort, candidateLimit)
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
    candidates: fuseRecordLists(lists, sort, query).slice(0, limit),
  }
}
