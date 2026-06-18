import { sql } from 'kysely'
import { db } from '../db/client'
import type { RecordKind } from '../domains/relations/types'
import { toMatchQuery } from './match-query'
import { combineScore, lexicalScore, recencyScore } from './ranking'

/**
 * The one shared retrieval contract (Plan 06). Ask, daily reports, graph
 * context, search enrichment, and the CLI all call {@link retrieve} rather than
 * each building their own index access. It runs FTS5 over derived
 * `content_chunks` and ranks the hits by lexical relevance + recency + an
 * optional explicit-link boost.
 *
 * `mode` accepts `lexical | semantic | hybrid`, but embeddings are an additive,
 * optional layer that is not yet wired (Plan 06 leaves the backend open). When a
 * semantic backend is unavailable the call degrades cleanly to lexical and
 * reports `semanticAvailable: false` — it never fails for lack of vectors.
 */
export type RetrievalMode = 'lexical' | 'semantic' | 'hybrid'

export type SourceRecordType = 'document' | 'interaction'

export interface RetrievedChunk {
  chunkId: string
  text: string
  /** A highlighted excerpt around the match (FTS5 snippet). */
  snippet: string
  recordType: SourceRecordType
  recordId: string
  recordTitle: string | null
  chunkIndex: number
  /** Combined rank in roughly [0, 1.25]; higher is better. */
  score: number
  lexicalScore: number
}

export interface RetrievalResult {
  query: string
  mode: RetrievalMode
  /** Whether a semantic backend contributed. Always `false` until embeddings land. */
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
/** Over-fetch lexical hits so the re-rank has room to reorder by recency/links. */
const CANDIDATE_MULTIPLIER = 4

function emptyResult(query: string, mode: RetrievalMode): RetrievalResult {
  return { query, mode, semanticAvailable: false, chunks: [] }
}

/**
 * Retrieve ranked chunks for a query. Always lexical today; `semantic`/`hybrid`
 * are accepted and silently served by the lexical path with
 * `semanticAvailable: false` until an embedding backend is registered.
 */
export async function retrieve(query: string, options: RetrieveOptions = {}): Promise<RetrievalResult> {
  const mode = options.mode ?? 'hybrid'
  const limit = options.limit ?? DEFAULT_LIMIT
  // Question-style retrieval favours recall; bm25 still ranks by how many (and
  // how rare) the matched terms are, so OR does not flatten relevance.
  const match = toMatchQuery(query, { op: 'or' })
  if (!match) return emptyResult(query, mode)

  const candidateLimit = limit * CANDIDATE_MULTIPLIER
  const boost = new Set(options.boostRecordIds ?? [])
  const now = options.now ?? new Date()

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
    LIMIT ${candidateLimit}
  `.execute(db)

  const chunks: RetrievedChunk[] = result.rows.map((row) => {
    const lexical = lexicalScore(Number(row.bm25))
    const recency = recencyScore(row.recordDate, now)
    const linked = boost.has(row.recordId)
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

  return {
    query,
    mode,
    semanticAvailable: false,
    chunks: chunks.slice(0, limit),
  }
}

/** The kinds {@link retrieve} can ground answers in (source records only). */
export const RETRIEVABLE_SOURCE_KINDS: readonly RecordKind[] = ['document', 'interaction']
