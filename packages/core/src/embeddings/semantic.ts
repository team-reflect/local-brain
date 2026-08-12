import { sql } from 'kysely'
import { db } from '../db/client'
import {
  chunkFilterClauses,
  chunkNavigationRecordId,
  chunkNavigationRecordType,
  chunkRecordDate,
  chunkRecordJoins,
  chunkRecordTitle,
  chunkVisibilityFilter,
  type ChunkFilters,
} from '../retrieval/chunk-sources'
import { normalizedEvidenceText } from '../retrieval/record-candidate-evidence'
import type { NavigableRecordType } from '../retrieval/record-candidate-types'
import type { RetrievedChunk, SourceRecordType } from '../retrieval/retrieve'
import { EMBEDDING_MODEL_ID } from './model'

/**
 * Semantic retrieval over the `chunk_vectors` (sqlite-vec) projection, plus the
 * Reciprocal Rank Fusion that blends it with lexical hits for hybrid mode
 * (Reflect-embeddings port). Pure-ish: `semanticHits` reads the DB, `fuseRanked`
 * is a deterministic combinator with no I/O.
 */

/** Minimum KNN pool before filtering; record-diverse callers may expand it. */
export const KNN_CANDIDATES = 24

/**
 * Structural filters and record-level diversity are applied after vec0's KNN
 * selection. Pull a wider neighbour pool so one long record (or many globally
 * close but filtered records) is much less likely to exhaust that pool before
 * the typed joins run.
 */
const KNN_OVERFETCH_MULTIPLIER = 4
const MAX_KNN_CANDIDATES = 8_192
const DEFAULT_RECORD_CHUNK_CAP = 2

/**
 * Cosine-distance cutoff: neighbours farther than this are noise, not matches.
 * Tuned for all-MiniLM-L6-v2 (a real match sits well under 0.7; unrelated text
 * lands above it), inherited from Reflect's tuning of the same model.
 */
export const MAX_COSINE_DISTANCE = 0.7

/** Standard RRF damping constant. Larger = flatter contribution per rank. */
export const RRF_K = 60

interface SemanticHitRow {
  chunkId: string
  text: string
  contentHash: string | null
  recordType: SourceRecordType
  recordId: string
  recordTitle: string | null
  recordDate: string | null
  navigationRecordType: NavigableRecordType | null
  navigationRecordId: string | null
  chunkIndex: number
  distance: number
}

interface SemanticChunk extends RetrievedChunk {
  contentHash: string | null
}

/** Bounds and structural filters for one semantic chunk query. */
export interface SemanticHitOptions {
  /** Maximum chunks returned after filtering and optional per-record capping. */
  limit: number
  /** Typed/date/relation-derived filters applied after vec0 selects neighbours. */
  filters?: ChunkFilters
  /** Expand the KNN pool until this many unique filtered records are found. */
  minUniqueRecords?: number
  /** Per-record cap used with record-diverse retrieval. */
  maxChunksPerRecord?: number
}

/** A short preview when there is no FTS snippet (semantic-only hits). */
function previewOf(text: string, max = 240): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`
}

/**
 * Nearest chunks to `queryVector` by cosine distance, mapped to the shared
 * {@link RetrievedChunk} shape. The KNN runs in a CTE so the `MATCH … AND k`
 * constraint stays on the vec0 table alone, then the join + archived/record-type
 * filters apply to the neighbours. The `chunk_embeddings` join is pinned to the
 * current {@link EMBEDDING_MODEL_ID} so vectors left over from an older model
 * (after a model change or a partial rebuild) can never rank into the results.
 * `score` is cosine similarity (1 − distance).
 */
async function semanticRows(
  vectorJson: string,
  k: number,
  filters: ChunkFilters | undefined,
): Promise<SemanticHitRow[]> {
  const result = await sql<SemanticHitRow>`
    WITH knn AS (
      SELECT rowid, distance
      FROM chunk_vectors
      WHERE embedding MATCH ${vectorJson} AND k = ${k}
    )
    SELECT
      cc.id           AS "chunkId",
      cc.text         AS "text",
      cc.content_hash AS "contentHash",
      cc.record_type  AS "recordType",
      cc.record_id    AS "recordId",
      cc.chunk_index  AS "chunkIndex",
      ${chunkRecordTitle} AS "recordTitle",
      ${chunkRecordDate}  AS "recordDate",
      ${chunkNavigationRecordType} AS "navigationRecordType",
      ${chunkNavigationRecordId} AS "navigationRecordId",
      knn.distance               AS "distance"
    FROM knn
    JOIN chunk_embeddings ce ON ce.id = knn.rowid AND ce.model_id = ${EMBEDDING_MODEL_ID}
    JOIN content_chunks cc   ON cc.id = ce.chunk_id AND cc.content_hash = ce.content_hash
    ${chunkRecordJoins}
    WHERE ${chunkVisibilityFilter}
      ${chunkFilterClauses(filters)}
    ORDER BY knn.distance
  `.execute(db)
  return result.rows
}

function mapSemanticRows(rows: readonly SemanticHitRow[]): SemanticChunk[] {
  return rows
    .filter((row) => Number(row.distance) <= MAX_COSINE_DISTANCE)
    .map((row) => {
      const similarity = 1 - Number(row.distance)
      return {
        chunkId: row.chunkId,
        text: row.text,
        contentHash: row.contentHash,
        snippet: previewOf(row.text),
        recordType: row.recordType,
        recordId: row.recordId,
        recordTitle: row.recordTitle,
        navigationRecordType: row.navigationRecordType,
        navigationRecordId: row.navigationRecordId,
        recordDate: row.recordDate ?? null,
        chunkIndex: Number(row.chunkIndex),
        score: similarity,
        lexicalScore: 0,
        semanticScore: similarity,
      }
    })
}

function roundRobinUniqueChunks(
  hits: readonly SemanticChunk[],
  maxChunksPerRecord: number,
  limit: number,
): SemanticChunk[] {
  const records = new Map<string, {
    hits: SemanticChunk[]
    contentHashes: Set<string>
    texts: Set<string>
  }>()
  for (const hit of hits) {
    const key = `${hit.recordType}:${hit.recordId}`
    const record = records.get(key) ?? {
      hits: [],
      contentHashes: new Set<string>(),
      texts: new Set<string>(),
    }
    if (record.hits.length >= maxChunksPerRecord) continue

    const contentHash = hit.contentHash?.trim()
    const normalizedText = normalizedEvidenceText(hit.text)
    if ((contentHash && record.contentHashes.has(contentHash)) || record.texts.has(normalizedText)) continue
    if (contentHash) record.contentHashes.add(contentHash)
    record.texts.add(normalizedText)
    record.hits.push(hit)
    records.set(key, record)
  }

  const selected: SemanticChunk[] = []
  for (let rank = 0; rank < maxChunksPerRecord && selected.length < limit; rank += 1) {
    for (const record of records.values()) {
      const hit = record.hits[rank]
      if (hit) selected.push(hit)
      if (selected.length >= limit) break
    }
  }
  return selected
}

function stripContentHash(hits: readonly SemanticChunk[]): RetrievedChunk[] {
  return hits.map(({ contentHash: _contentHash, ...hit }) => hit)
}

/**
 * Retrieve semantic chunks with optional record-diverse adaptive expansion.
 * vec0 chooses global neighbours before typed SQL filters run, so record-level
 * callers can request expansion up to a bounded ceiling when the first pool is
 * dominated by one source or by rows later removed by filters.
 */
export async function semanticHits(
  queryVector: readonly number[],
  options: SemanticHitOptions = { limit: 12 },
): Promise<RetrievedChunk[]> {
  const vectorJson = JSON.stringify(Array.from(queryVector))
  const initialK = Math.max(options.limit * KNN_OVERFETCH_MULTIPLIER, KNN_CANDIDATES)
  const maxK = Math.max(initialK, MAX_KNN_CANDIDATES)
  let k = initialK

  while (true) {
    const hits = mapSemanticRows(await semanticRows(vectorJson, k, options.filters))
    if (!options.minUniqueRecords) return stripContentHash(hits.slice(0, options.limit))

    const uniqueRecords = new Set(hits.map((hit) => `${hit.recordType}:${hit.recordId}`)).size
    if (uniqueRecords >= options.minUniqueRecords || k >= maxK) {
      return stripContentHash(
        roundRobinUniqueChunks(
          hits,
          options.maxChunksPerRecord ?? DEFAULT_RECORD_CHUNK_CAP,
          options.limit,
        ),
      )
    }
    k = Math.min(k * 2, maxK)
  }
}

/**
 * Reciprocal Rank Fusion across ranked lists, keyed by chunk id. Each list
 * contributes `1 / (RRF_K + rank)` per item; the merged hit keeps whichever
 * form carries the richer fields (a lexical snippet over a plain preview) and
 * the best per-source scores. Scale-free and deterministic — no tuned weights.
 */
export function fuseRanked(lists: readonly RetrievedChunk[][], limit: number): RetrievedChunk[] {
  const fused = new Map<string, { hit: RetrievedChunk; rrf: number }>()
  for (const list of lists) {
    list.forEach((hit, index) => {
      const contribution = 1 / (RRF_K + index + 1)
      const entry = fused.get(hit.chunkId)
      if (entry) {
        entry.rrf += contribution
        entry.hit = {
          ...entry.hit,
          // Prefer a real FTS snippet over a semantic preview.
          snippet: entry.hit.lexicalScore > 0 ? entry.hit.snippet : hit.snippet,
          lexicalScore: Math.max(entry.hit.lexicalScore, hit.lexicalScore),
          semanticScore: Math.max(entry.hit.semanticScore ?? 0, hit.semanticScore ?? 0),
        }
      } else {
        fused.set(hit.chunkId, { hit: { ...hit }, rrf: contribution })
      }
    })
  }
  return [...fused.values()]
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, limit)
    .map(({ hit, rrf }) => ({ ...hit, score: rrf }))
}
