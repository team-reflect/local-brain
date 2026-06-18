import { sql } from 'kysely'
import { db } from '../db/client'
import type { RetrievedChunk, SourceRecordType } from '../retrieval/retrieve'

/**
 * Semantic retrieval over the `chunk_vectors` (sqlite-vec) projection, plus the
 * Reciprocal Rank Fusion that blends it with lexical hits for hybrid mode
 * (Reflect-embeddings port). Pure-ish: `semanticHits` reads the DB, `fuseRanked`
 * is a deterministic combinator with no I/O.
 */

/** How many nearest neighbours to pull before filtering/ranking. */
export const KNN_CANDIDATES = 24

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
  recordType: SourceRecordType
  recordId: string
  recordTitle: string | null
  chunkIndex: number
  distance: number
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
 * filters apply to the neighbours. `score` is cosine similarity (1 − distance).
 */
export async function semanticHits(
  queryVector: readonly number[],
  options: { limit: number; recordType?: SourceRecordType | undefined } = { limit: 12 },
): Promise<RetrievedChunk[]> {
  const k = Math.max(options.limit, KNN_CANDIDATES)
  const vectorJson = JSON.stringify(Array.from(queryVector))
  const recordTypeFilter = options.recordType
    ? sql`AND cc.record_type = ${options.recordType}`
    : sql``

  const result = await sql<SemanticHitRow>`
    WITH knn AS (
      SELECT rowid, distance
      FROM chunk_vectors
      WHERE embedding MATCH ${vectorJson} AND k = ${k}
    )
    SELECT
      cc.id           AS "chunkId",
      cc.text         AS "text",
      cc.record_type  AS "recordType",
      cc.record_id    AS "recordId",
      cc.chunk_index  AS "chunkIndex",
      COALESCE(d.title, i.title) AS "recordTitle",
      knn.distance               AS "distance"
    FROM knn
    JOIN chunk_embeddings ce ON ce.id = knn.rowid
    JOIN content_chunks cc   ON cc.id = ce.chunk_id
    LEFT JOIN documents d    ON d.id = cc.record_id AND cc.record_type = 'document'
    LEFT JOIN interactions i ON i.id = cc.record_id AND cc.record_type = 'interaction'
    WHERE (d.archived_at IS NULL)
      AND (i.archived_at IS NULL)
      ${recordTypeFilter}
    ORDER BY knn.distance
  `.execute(db)

  return result.rows
    .filter((row) => Number(row.distance) <= MAX_COSINE_DISTANCE)
    .map((row) => {
      const similarity = 1 - Number(row.distance)
      return {
        chunkId: row.chunkId,
        text: row.text,
        snippet: previewOf(row.text),
        recordType: row.recordType,
        recordId: row.recordId,
        recordTitle: row.recordTitle,
        chunkIndex: Number(row.chunkIndex),
        score: similarity,
        lexicalScore: 0,
        semanticScore: similarity,
      }
    })
    .slice(0, options.limit)
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
