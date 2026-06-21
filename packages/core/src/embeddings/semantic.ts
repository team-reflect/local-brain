import { sql } from 'kysely'
import { db } from '../db/client'
import type { RetrievedChunk, SourceRecordType } from '../retrieval/retrieve'
import { EMBEDDING_MODEL_ID } from './model'

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
 * filters apply to the neighbours. The `chunk_embeddings` join is pinned to the
 * current {@link EMBEDDING_MODEL_ID} so vectors left over from an older model
 * (after a model change or a partial rebuild) can never rank into the results.
 * `score` is cosine similarity (1 − distance).
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
      COALESCE(
        p.full_name,
        o.name,
        op.one_line_description,
        pr.name,
        t.title,
        d.title,
        i.title,
        transcript_interaction.title,
        an.title,
        ef.key,
        m.claim,
        a.original_filename,
        a.storage_path
      ) AS "recordTitle",
      knn.distance               AS "distance"
    FROM knn
    JOIN chunk_embeddings ce ON ce.id = knn.rowid AND ce.model_id = ${EMBEDDING_MODEL_ID}
    JOIN content_chunks cc   ON cc.id = ce.chunk_id
    LEFT JOIN people p ON p.id = cc.record_id AND cc.record_type = 'person'
    LEFT JOIN organizations o ON o.id = cc.record_id AND cc.record_type = 'organization'
    LEFT JOIN organization_profiles op ON op.id = cc.record_id AND cc.record_type = 'organization_profile'
    LEFT JOIN projects pr ON pr.id = cc.record_id AND cc.record_type = 'project'
    LEFT JOIN tasks t ON t.id = cc.record_id AND cc.record_type = 'task'
    LEFT JOIN documents d ON d.id = cc.record_id AND cc.record_type = 'document'
    LEFT JOIN interactions i ON i.id = cc.record_id AND cc.record_type = 'interaction'
    LEFT JOIN interaction_transcripts tr ON tr.id = cc.record_id AND cc.record_type = 'interaction_transcript'
    LEFT JOIN interactions transcript_interaction ON transcript_interaction.id = tr.interaction_id
    LEFT JOIN ai_notes an ON an.id = cc.record_id AND cc.record_type = 'ai_note'
    LEFT JOIN extracted_facts ef ON ef.id = cc.record_id AND cc.record_type = 'extracted_fact'
    LEFT JOIN memories m ON m.id = cc.record_id AND cc.record_type = 'memory'
    LEFT JOIN assets a ON a.id = cc.record_id AND cc.record_type = 'asset'
    WHERE (
        (cc.record_type = 'person' AND p.archived_at IS NULL)
        OR (cc.record_type = 'organization' AND o.archived_at IS NULL)
        OR (cc.record_type = 'organization_profile' AND op.id IS NOT NULL)
        OR (cc.record_type = 'project' AND pr.archived_at IS NULL)
        OR (cc.record_type = 'task' AND t.archived_at IS NULL)
        OR (cc.record_type = 'document' AND d.archived_at IS NULL)
        OR (cc.record_type = 'interaction' AND i.archived_at IS NULL)
        OR (cc.record_type = 'interaction_transcript' AND tr.id IS NOT NULL AND transcript_interaction.archived_at IS NULL)
        OR (cc.record_type = 'ai_note' AND an.id IS NOT NULL)
        OR (cc.record_type = 'extracted_fact' AND ef.archived_at IS NULL)
        OR (cc.record_type = 'memory' AND m.archived_at IS NULL)
        OR (cc.record_type = 'asset' AND a.archived_at IS NULL)
      )
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
