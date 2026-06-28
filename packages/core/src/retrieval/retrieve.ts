import { sql } from 'kysely'
import { db } from '../db/client'
import { embedStatus, embedTexts } from '../embeddings/commands'
import { isEmbedReady } from '../embeddings/model'
import { fuseRanked, semanticHits } from '../embeddings/semantic'
import { isEmbeddingsEnabled } from '../embeddings/status'
import {
  chunkFilterClauses,
  chunkRecordDate,
  chunkRecordJoins,
  chunkRecordTitle,
  chunkVisibilityFilter,
  type ChunkFilters,
} from './chunk-sources'
import { toMatchQuery } from './match-query'
import { combineScore, lexicalScore, recencyScore } from './ranking'

/**
 * The one shared retrieval contract (Plan 06). Daily reports, graph
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

/**
 * Result ordering. `relevance` ranks by match quality (bm25 / vector distance,
 * recency-weighted); `recency` orders strictly newest-first and is treated as
 * chronological — it stays lexical/browse so a semantic re-rank can't fight the
 * order. Defaults to `relevance` when a query is present, `recency` when browsing.
 */
export type SortMode = 'relevance' | 'recency'

export type SourceRecordType =
  | 'person'
  | 'organization'
  | 'organization_profile'
  | 'project'
  | 'task'
  | 'document'
  | 'interaction'
  | 'interaction_transcript'
  | 'ai_note'
  | 'extracted_fact'
  | 'memory'
  | 'asset'

export interface RetrievedChunk {
  chunkId: string
  text: string
  /** A highlighted excerpt around the match (FTS5 snippet), or a plain preview. */
  snippet: string
  recordType: SourceRecordType
  recordId: string
  recordTitle: string | null
  /** The owning record's event date (ISO 8601), or null when undated. */
  recordDate: string | null
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
  /** Restrict to one source type. Shorthand for `recordTypes: [recordType]`. */
  recordType?: SourceRecordType
  /** Restrict to these source types. Supersedes {@link recordType} when set. */
  recordTypes?: readonly SourceRecordType[]
  /** Restrict interaction-backed chunks to these kinds (e.g. `["email"]`). */
  kinds?: readonly string[]
  /** Only records on/after this ISO 8601 (UTC) date. */
  after?: string
  /** Only records on/before this ISO 8601 (UTC) date. */
  before?: string
  /** Order results by match relevance (default) or strict recency. */
  sort?: SortMode
  /**
   * Owning source record ids considered "in context" (e.g. the records
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

/** Epoch millis for a record date, or -Infinity when missing/unparseable. */
function recordTime(date: string | null): number {
  if (!date) return Number.NEGATIVE_INFINITY
  const parsed = Date.parse(date)
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

/** Newest first, undated last; ties broken by combined score. */
function byRecency(a: RetrievedChunk, b: RetrievedChunk): number {
  return recordTime(b.recordDate) - recordTime(a.recordDate) || b.score - a.score
}

/** A short plain preview for a chunk that has no FTS snippet (browse hits). */
function previewOf(text: string, max = 240): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`
}

/**
 * Lexical FTS5 retrieval over `content_chunks`, ranked by bm25 + recency + an
 * optional link boost (relevance) or strict newest-first (recency). `match` is a
 * non-empty FTS5 MATCH expression — the caller has already rejected empty queries.
 */
async function lexicalHits(
  match: string,
  options: {
    limit: number
    filters: ChunkFilters
    sort: SortMode
    boost: ReadonlySet<string>
    now: Date
  },
): Promise<RetrievedChunk[]> {
  // bm25(): more negative = more relevant. snippet() highlights the matched
  // span within the chunk text (column 0 of content_chunks_fts). For recency we
  // page by date so the LIMIT keeps the newest matches, not the most relevant.
  const orderBy = options.sort === 'recency' ? sql`${chunkRecordDate} DESC` : sql`bm25(content_chunks_fts)`

  const result = await sql<ChunkHitRow>`
    SELECT
      cc.id           AS "chunkId",
      cc.text         AS "text",
      snippet(content_chunks_fts, 0, '[', ']', '…', 12) AS "snippet",
      cc.record_type  AS "recordType",
      cc.record_id    AS "recordId",
      cc.chunk_index  AS "chunkIndex",
      ${chunkRecordTitle} AS "recordTitle",
      ${chunkRecordDate}  AS "recordDate",
      bm25(content_chunks_fts)              AS "bm25"
    FROM content_chunks_fts
    JOIN content_chunks cc ON cc.rowid = content_chunks_fts.rowid
    ${chunkRecordJoins}
    WHERE content_chunks_fts MATCH ${match}
      AND ${chunkVisibilityFilter}
      ${chunkFilterClauses(options.filters)}
    ORDER BY ${orderBy}
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
      recordDate: row.recordDate,
      chunkIndex: Number(row.chunkIndex),
      lexicalScore: lexical,
      score: combineScore({ lexical, recency, linked }),
    }
  })

  chunks.sort(options.sort === 'recency' ? byRecency : (a, b) => b.score - a.score)
  return chunks
}

interface BrowseHitRow {
  chunkId: string
  text: string
  recordType: SourceRecordType
  recordId: string
  recordTitle: string | null
  recordDate: string | null
  chunkIndex: number
}

/**
 * Query-less browse: the most recent records matching the structural filters,
 * one representative (first) chunk per record, newest first. This is what powers
 * "list recent transcripts / emails" — a list of records by date, not a keyword
 * search. A window function keeps only `chunk_index = 0` per record so a single
 * long record can't crowd the results with its own chunks.
 */
async function browseHits(options: {
  limit: number
  filters: ChunkFilters
  now: Date
}): Promise<RetrievedChunk[]> {
  const result = await sql<BrowseHitRow>`
    WITH first_chunks AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY record_id ORDER BY chunk_index) AS rn
      FROM content_chunks
    )
    SELECT
      cc.id           AS "chunkId",
      cc.text         AS "text",
      cc.record_type  AS "recordType",
      cc.record_id    AS "recordId",
      cc.chunk_index  AS "chunkIndex",
      ${chunkRecordTitle} AS "recordTitle",
      ${chunkRecordDate}  AS "recordDate"
    FROM first_chunks cc
    ${chunkRecordJoins}
    WHERE cc.rn = 1
      AND ${chunkVisibilityFilter}
      ${chunkFilterClauses(options.filters)}
    ORDER BY ${chunkRecordDate} DESC
    LIMIT ${options.limit}
  `.execute(db)

  return result.rows.map((row) => ({
    chunkId: row.chunkId,
    text: row.text,
    snippet: previewOf(row.text),
    recordType: row.recordType,
    recordId: row.recordId,
    recordTitle: row.recordTitle,
    recordDate: row.recordDate,
    chunkIndex: Number(row.chunkIndex),
    lexicalScore: 0,
    score: recencyScore(row.recordDate, options.now),
  }))
}

/** Resolve the option fields into the shared {@link ChunkFilters} shape. */
function buildFilters(options: RetrieveOptions): ChunkFilters {
  const recordTypes = options.recordTypes ?? (options.recordType ? [options.recordType] : undefined)
  return {
    ...(recordTypes && recordTypes.length > 0 ? { recordTypes } : {}),
    ...(options.kinds && options.kinds.length > 0 ? { kinds: options.kinds } : {}),
    ...(options.after ? { after: options.after } : {}),
    ...(options.before ? { before: options.before } : {}),
  }
}

/** True when at least one structural filter is set. */
function hasFilters(filters: ChunkFilters): boolean {
  return Boolean(filters.recordTypes?.length || filters.kinds?.length || filters.after || filters.before)
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
  const filters = buildFilters(options)
  const sort: SortMode = options.sort ?? 'relevance'
  const candidateLimit = limit * CANDIDATE_MULTIPLIER
  // Question-style retrieval favours recall; bm25 still ranks by how many (and
  // how rare) the matched terms are, so OR does not flatten relevance.
  const match = toMatchQuery(query, { op: 'or' })

  // No searchable query: browse recent records by filter, or return nothing when
  // the call is unconstrained (preserve "blank query → []"). Browsing never
  // consults the embedding runtime — there is no query to embed.
  if (!match) {
    const chunks = hasFilters(filters) ? await browseHits({ limit, filters, now }) : []
    return { query, mode, semanticAvailable: false, chunks }
  }

  // Recency sort is chronological; a semantic re-rank would fight the ordering,
  // so it stays lexical regardless of the requested mode.
  if (mode === 'lexical' || sort === 'recency') {
    const chunks = await lexicalHits(match, { limit, filters, sort, boost, now })
    return { query, mode, semanticAvailable: false, chunks }
  }

  async function trySemanticHits(searchLimit: number): Promise<RetrievedChunk[] | null> {
    const status = (await isEmbeddingsEnabled()) ? await embedStatus() : null
    if (!status || !isEmbedReady(status)) return null

    const [vector] = await embedTexts([query])
    if (!vector || vector.length === 0) return null

    const semantic = await semanticHits(vector, { limit: searchLimit, filters })
    return semantic.length > 0 ? semantic : null
  }

  if (mode === 'hybrid') {
    // Hybrid needs lexical hits either way, so start the fast FTS leg while the
    // embedding runtime computes the query vector and KNN neighbours.
    const lexicalPromise = lexicalHits(match, { limit: candidateLimit, filters, sort, boost, now }).then(
      (chunks) => ({ ok: true as const, chunks }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    const awaitLexical = async (): Promise<RetrievedChunk[]> => {
      const result = await lexicalPromise
      if (!result.ok) throw result.error
      return result.chunks
    }

    try {
      const semantic = await trySemanticHits(candidateLimit)
      // A `ready` runtime can still contribute nothing: KNN may find no neighbour
      // within the distance cutoff (sparse/empty vector index, or a query whose
      // nearest vectors are all too far). `semanticAvailable` means "a semantic
      // backend actually contributed", so an empty KNN result must NOT claim it.
      if (semantic) {
        const lexical = await awaitLexical()
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
    } catch {
      // Runtime unavailable (no bridge, non-desktop host, embed error): degrade.
    }

    // Preserve lexical fallback semantics exactly: the concurrent lexical query
    // intentionally over-fetches for fusion, but fallback should match an
    // explicit lexical search with the requested limit.
    const chunks = await lexicalHits(match, { limit, filters, sort, boost, now })
    return { query, mode, semanticAvailable: false, chunks }
  }

  // Semantic mode: try the embedding runtime, degrade to lexical on anything
  // that isn't a clean `ready` + successful embed. Lexical never gets skipped on
  // failure, so retrieval can't return empty just because vectors are missing.
  // Respect the user's kill-switch first: if semantic search is disabled we must
  // not embed the query or use vectors, even while the model stays loaded.
  try {
    const semantic = await trySemanticHits(limit)
    // Fall through to the lexical-only path below when a ready runtime
    // contributes nothing, so `semantic` mode never returns empty while lexical
    // hits exist.
    if (semantic) {
      return {
        query,
        mode,
        semanticAvailable: true,
        chunks: boostSemantic(semantic, boost).slice(0, limit),
      }
    }
  } catch {
    // Runtime unavailable (no bridge, non-desktop host, embed error): degrade.
  }

  const chunks = await lexicalHits(match, { limit, filters, sort, boost, now })
  return { query, mode, semanticAvailable: false, chunks }
}

/** The source kinds {@link retrieve} can ground answers in. */
export const RETRIEVABLE_SOURCE_KINDS: readonly SourceRecordType[] = [
  'person',
  'organization',
  'organization_profile',
  'project',
  'task',
  'document',
  'interaction',
  'interaction_transcript',
  'ai_note',
  'extracted_fact',
  'memory',
  'asset',
]
