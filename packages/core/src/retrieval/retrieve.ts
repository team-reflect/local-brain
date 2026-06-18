import { sql } from 'kysely'
import { db } from '../db/client'
import type { RecordKind } from '../domains/relations/types'
import { embedStatus, embedTexts } from '../embeddings/commands'
import { isEmbedReady } from '../embeddings/model'
import { fuseRanked, semanticHits } from '../embeddings/semantic'
import { isEmbeddingsEnabled } from '../embeddings/status'
import { toMatchQuery } from './match-query'
import { combineScore, lexicalScore, recencyScore } from './ranking'

/**
 * The one shared retrieval contract (Plan 06). Ask, daily reports, graph
 * context, search enrichment, and the CLI all call {@link retrieve} rather than
 * each building their own index access. It runs FTS5 over derived
 * `content_chunks` and ranks the hits by lexical relevance + recency + an
 * optional explicit-link boost.
 *
 * `mode` accepts `lexical | semantic | hybrid`. Semantic/hybrid use the local
 * embedding runtime (sqlite-vec + fastembed, desktop): when the user has enabled
 * semantic search AND the runtime is `ready`, the query is embedded and vector
 * neighbours are blended with lexical hits via Reciprocal Rank Fusion. When
 * semantic search is disabled, the runtime is unavailable — no model loaded, a
 * non-desktop host, or any embed error — the call degrades cleanly to lexical
 * and reports `semanticAvailable: false`. It never fails for lack of vectors.
 */
export type RetrievalMode = 'lexical' | 'semantic' | 'hybrid'

export type SourceRecordType = 'document' | 'interaction'

export interface RetrievedChunk {
  chunkId: string
  text: string
  /** A highlighted excerpt around the match (FTS5 snippet), or a plain preview. */
  snippet: string
  recordType: SourceRecordType
  recordId: string
  recordTitle: string | null
  chunkIndex: number
  /** Combined rank; higher is better. Scale depends on mode (lexical vs RRF). */
  score: number
  /** Lexical relevance in [0, 1]; 0 for a semantic-only hit. */
  lexicalScore: number
  /** Cosine similarity in [0, 1] when a vector contributed; absent otherwise. */
  semanticScore?: number
}

export interface RetrievalResult {
  query: string
  mode: RetrievalMode
  /** Whether a semantic backend actually contributed to these results. */
  semanticAvailable: boolean
  chunks: RetrievedChunk[]
}

export interface RetrieveOptions {
  mode?: RetrievalMode
  /** Max chunks to return after ranking. */
  limit?: number
  /** Restrict to one source type. */
  recordType?: SourceRecordType
  /**
   * Owning document/interaction ids considered "in context" (e.g. the records
   * linked to the project the user is viewing). Chunks from these records get a
   * relevance boost. Callers resolve context; retrieval stays a pure read.
   */
  boostRecordIds?: readonly string[]
  /** Override "now" for deterministic recency in tests. */
  now?: Date
}

interface ChunkHitRow {
  chunkId: string
  text: string
  snippet: string
  recordType: SourceRecordType
  recordId: string
  recordTitle: string | null
  recordDate: string | null
  chunkIndex: number
  bm25: number
}

const DEFAULT_LIMIT = 12
/** Over-fetch hits so the re-rank/fusion has room to reorder by recency/links. */
const CANDIDATE_MULTIPLIER = 4
/** Multiplicative boost for a chunk whose record is in the active context. */
const LINK_BOOST = 1.25

/**
 * Lexical FTS5 retrieval over `content_chunks`, ranked by bm25 + recency + an
 * optional link boost. Returns `[]` for a query with no searchable tokens.
 */
async function lexicalHits(
  query: string,
  options: {
    limit: number
    recordType: SourceRecordType | undefined
    boost: ReadonlySet<string>
    now: Date
  },
): Promise<RetrievedChunk[]> {
  // Question-style retrieval favours recall; bm25 still ranks by how many (and
  // how rare) the matched terms are, so OR does not flatten relevance.
  const match = toMatchQuery(query, { op: 'or' })
  if (!match) return []

  // bm25(): more negative = more relevant. snippet() highlights the matched
  // span within the chunk text (column 0 of content_chunks_fts).
  const recordTypeFilter = options.recordType
    ? sql`AND cc.record_type = ${options.recordType}`
    : sql``

  const result = await sql<ChunkHitRow>`
    SELECT
      cc.id           AS "chunkId",
      cc.text         AS "text",
      snippet(content_chunks_fts, 0, '[', ']', '…', 12) AS "snippet",
      cc.record_type  AS "recordType",
      cc.record_id    AS "recordId",
      cc.chunk_index  AS "chunkIndex",
      COALESCE(d.title, i.title)            AS "recordTitle",
      COALESCE(i.occurred_at, d.updated_at) AS "recordDate",
      bm25(content_chunks_fts)              AS "bm25"
    FROM content_chunks_fts
    JOIN content_chunks cc ON cc.rowid = content_chunks_fts.rowid
    LEFT JOIN documents d    ON d.id = cc.record_id AND cc.record_type = 'document'
    LEFT JOIN interactions i ON i.id = cc.record_id AND cc.record_type = 'interaction'
    WHERE content_chunks_fts MATCH ${match}
      AND (d.archived_at IS NULL)
      AND (i.archived_at IS NULL)
      ${recordTypeFilter}
    ORDER BY bm25(content_chunks_fts)
    LIMIT ${options.limit}
  `.execute(db)

  const chunks: RetrievedChunk[] = result.rows.map((row) => {
    const lexical = lexicalScore(Number(row.bm25))
    const recency = recencyScore(row.recordDate, options.now)
    const linked = options.boost.has(row.recordId)
    return {
      chunkId: row.chunkId,
      text: row.text,
      snippet: row.snippet,
      recordType: row.recordType,
      recordId: row.recordId,
      recordTitle: row.recordTitle,
      chunkIndex: Number(row.chunkIndex),
      lexicalScore: lexical,
      score: combineScore({ lexical, recency, linked }),
    }
  })

  chunks.sort((a, b) => b.score - a.score)
  return chunks
}

/** Apply the explicit-link boost to semantic hits and re-sort by score. */
function boostSemantic(hits: RetrievedChunk[], boost: ReadonlySet<string>): RetrievedChunk[] {
  if (boost.size === 0) return hits
  return hits
    .map((hit) => (boost.has(hit.recordId) ? { ...hit, score: hit.score * LINK_BOOST } : hit))
    .sort((a, b) => b.score - a.score)
}

/**
 * Retrieve ranked chunks for a query. Lexical always works; semantic/hybrid use
 * the embedding runtime when it is ready and otherwise degrade to lexical with
 * `semanticAvailable: false`.
 */
export async function retrieve(query: string, options: RetrieveOptions = {}): Promise<RetrievalResult> {
  const mode = options.mode ?? 'hybrid'
  const limit = options.limit ?? DEFAULT_LIMIT
  const now = options.now ?? new Date()
  const boost = new Set(options.boostRecordIds ?? [])
  const recordType = options.recordType
  const candidateLimit = limit * CANDIDATE_MULTIPLIER

  if (mode === 'lexical') {
    const chunks = await lexicalHits(query, { limit, recordType, boost, now })
    return { query, mode, semanticAvailable: false, chunks }
  }

  // Semantic / hybrid: try the embedding runtime, degrade to lexical on anything
  // that isn't a clean `ready` + successful embed. Lexical never gets skipped on
  // failure, so retrieval can't return empty just because vectors are missing.
  // Respect the user's kill-switch first: if semantic search is disabled we must
  // not embed the query or use vectors, even while the model stays loaded. And an
  // empty/whitespace query carries no semantic signal — embedding a blank string
  // and running KNN would surface unrelated nearest neighbours and falsely report
  // `semanticAvailable: true`, so we skip semantic entirely and degrade to lexical
  // (which itself returns `[]` for a query with no searchable tokens).
  try {
    const hasQueryText = query.trim().length > 0
    const status = hasQueryText && (await isEmbeddingsEnabled()) ? await embedStatus() : null
    if (status && isEmbedReady(status)) {
      const [vector] = await embedTexts([query])
      if (vector && vector.length > 0) {
        const semantic = await semanticHits(vector, {
          limit: mode === 'hybrid' ? candidateLimit : limit,
          recordType,
        })
        if (mode === 'semantic') {
          return {
            query,
            mode,
            semanticAvailable: true,
            chunks: boostSemantic(semantic, boost).slice(0, limit),
          }
        }
        const lexical = await lexicalHits(query, { limit: candidateLimit, recordType, boost, now })
        // Lexical hits already carry the explicit-link boost (via `combineScore`),
        // but the raw vector hits don't — apply the same boost so an in-context
        // semantic-only record ranks up *before* RRF fuses the two lists.
        const boostedSemantic = boostSemantic(semantic, boost)
        return {
          query,
          mode,
          semanticAvailable: true,
          chunks: fuseRanked([lexical, boostedSemantic], limit),
        }
      }
    }
  } catch {
    // Runtime unavailable (no bridge, non-desktop host, embed error): degrade.
  }

  const chunks = await lexicalHits(query, { limit, recordType, boost, now })
  return { query, mode, semanticAvailable: false, chunks }
}

/** The kinds {@link retrieve} can ground answers in (source records only). */
export const RETRIEVABLE_SOURCE_KINDS: readonly RecordKind[] = ['document', 'interaction']
