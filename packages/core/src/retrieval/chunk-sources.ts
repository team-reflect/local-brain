import { sql, type RawBuilder } from 'kysely'

/**
 * Shared SQL fragments for joining `content_chunks` back to their owning typed
 * record. Both the lexical retriever ({@link import('./retrieve').retrieve}) and
 * the semantic retriever ({@link import('../embeddings/semantic').semanticHits})
 * resolve the same set of record types, so the joins, the active/visible filter,
 * and the display-title fallback live here once instead of being copy-pasted into
 * two queries that must never drift apart.
 *
 * Every fragment assumes the outer query exposes the `content_chunks` row as
 * `cc` (e.g. `JOIN content_chunks cc ON …`) and binds the per-record aliases
 * used below (`p`, `o`, `op`, `pr`, `t`, `d`, `i`, `tr`, `transcript_interaction`,
 * `an`, `ef`, `m`, `a`).
 */

/**
 * Left-join each chunk to its owning record by `(record_type, record_id)`.
 * `interaction_transcript` chunks also reach the parent interaction so a
 * transcript can borrow its meeting's title/date and archived state.
 */
export const chunkRecordJoins = sql`
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
`

/**
 * Keep only chunks whose owning record exists and is not archived (records
 * without an `archived_at` column are gated on the join matching instead). This
 * is the single source of truth for which chunk-backed kinds are retrievable.
 */
export const chunkVisibilityFilter = sql`(
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
  )`

/** A human-readable title for a chunk's owning record, by record type. */
export const chunkRecordTitle = sql`COALESCE(
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
  )`

/**
 * The single "when did this happen" date for a chunk's owning record, resolved
 * by record type. Prefers the meaningful event date (occurred/authored/due/…)
 * and falls back through `updated_at`. This is the one date both the recency
 * ranking ({@link import('./ranking').recencyScore}) and the date-window filters
 * read, so "recent" means the same thing whether sorting or filtering. Splice it
 * into a SELECT (`AS "recordDate"`), a WHERE bound, or an `ORDER BY`.
 */
export const chunkRecordDate = sql`COALESCE(
    i.occurred_at,
    transcript_interaction.occurred_at,
    d.occurred_at,
    d.authored_at,
    t.due_at,
    an.generated_at,
    ef.observed_at,
    m.valid_from,
    p.last_interaction_at,
    d.updated_at,
    i.updated_at,
    p.updated_at,
    o.updated_at,
    pr.updated_at,
    t.updated_at,
    an.updated_at,
    ef.updated_at,
    m.updated_at,
    a.updated_at
  )`

/** Optional structural filters narrowing which chunks a retriever considers. */
export interface ChunkFilters {
  /** Restrict to these record types (`cc.record_type IN …`). */
  recordTypes?: readonly string[]
  /**
   * Restrict interaction-backed chunks to these interaction kinds
   * (e.g. `email`, `meeting`, `call`). Applies to an interaction and to the
   * parent interaction of a transcript; setting it naturally excludes
   * non-interaction records, which carry no kind.
   */
  kinds?: readonly string[]
  /** Lower bound (inclusive) on {@link chunkRecordDate}, ISO 8601 (UTC). */
  after?: string
  /**
   * Upper bound (inclusive) on {@link chunkRecordDate}, ISO 8601 (UTC). A
   * date-only value (`YYYY-MM-DD`) covers the whole day — see
   * {@link inclusiveUpperBound}.
   */
  before?: string
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Expand a date-only upper bound to the end of that day so a `<=` string
 * comparison still includes records timestamped later on the same day. Without
 * this, `before: '2026-06-18'` would drop a record at `2026-06-18T09:00:00Z`
 * because `'2026-06-18T09:00:00Z' <= '2026-06-18'` is false. Full timestamps
 * pass through untouched.
 */
function inclusiveUpperBound(before: string): string {
  return DATE_ONLY.test(before) ? `${before}T23:59:59.999Z` : before
}

/**
 * Build the optional `AND …` filter clauses spliced into a chunk WHERE clause,
 * shared by the lexical, browse, and semantic retrievers so the three never
 * drift. Returns an empty fragment when no filter is set. Assumes the outer query
 * binds the record aliases from {@link chunkRecordJoins}.
 */
export function chunkFilterClauses(filters: ChunkFilters = {}): RawBuilder<unknown> {
  const clauses: RawBuilder<unknown>[] = []
  if (filters.recordTypes && filters.recordTypes.length > 0) {
    const types = sql.join(filters.recordTypes.map((t) => sql`${t}`))
    clauses.push(sql`cc.record_type IN (${types})`)
  }
  if (filters.kinds && filters.kinds.length > 0) {
    const kinds = sql.join(filters.kinds.map((k) => sql`${k}`))
    clauses.push(sql`(i.kind IN (${kinds}) OR transcript_interaction.kind IN (${kinds}))`)
  }
  if (filters.after) clauses.push(sql`${chunkRecordDate} >= ${filters.after}`)
  if (filters.before) clauses.push(sql`${chunkRecordDate} <= ${inclusiveUpperBound(filters.before)}`)
  if (clauses.length === 0) return sql``
  return sql`AND ${sql.join(clauses, sql` AND `)}`
}
