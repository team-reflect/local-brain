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
 * `profile_organization`, `an`, the `ai_note_*` subject aliases, `ef`, `m`,
 * `a`).
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
  LEFT JOIN organizations profile_organization ON profile_organization.id = op.organization_id
  LEFT JOIN projects pr ON pr.id = cc.record_id AND cc.record_type = 'project'
  LEFT JOIN tasks t ON t.id = cc.record_id AND cc.record_type = 'task'
  LEFT JOIN documents d ON d.id = cc.record_id AND cc.record_type = 'document'
  LEFT JOIN interactions i ON i.id = cc.record_id AND cc.record_type = 'interaction'
  LEFT JOIN interaction_transcripts tr ON tr.id = cc.record_id AND cc.record_type = 'interaction_transcript'
  LEFT JOIN interactions transcript_interaction ON transcript_interaction.id = tr.interaction_id
  LEFT JOIN ai_notes an ON an.id = cc.record_id AND cc.record_type = 'ai_note'
  LEFT JOIN people ai_note_person ON ai_note_person.id = an.subject_id AND an.subject_type = 'person'
  LEFT JOIN organizations ai_note_organization ON ai_note_organization.id = an.subject_id AND an.subject_type = 'organization'
  LEFT JOIN projects ai_note_project ON ai_note_project.id = an.subject_id AND an.subject_type = 'project'
  LEFT JOIN tasks ai_note_task ON ai_note_task.id = an.subject_id AND an.subject_type = 'task'
  LEFT JOIN documents ai_note_document ON ai_note_document.id = COALESCE(an.document_id, CASE WHEN an.subject_type = 'document' THEN an.subject_id END)
  LEFT JOIN interactions ai_note_interaction ON ai_note_interaction.id = COALESCE(an.interaction_id, CASE WHEN an.subject_type = 'interaction' THEN an.subject_id END)
  LEFT JOIN assets ai_note_asset ON ai_note_asset.id = an.subject_id AND an.subject_type = 'asset'
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
    (cc.record_type = 'person' AND p.id IS NOT NULL AND p.archived_at IS NULL)
    OR (cc.record_type = 'organization' AND o.id IS NOT NULL AND o.archived_at IS NULL)
    OR (cc.record_type = 'organization_profile' AND op.id IS NOT NULL
        AND profile_organization.id IS NOT NULL AND profile_organization.archived_at IS NULL)
    OR (cc.record_type = 'project' AND pr.id IS NOT NULL AND pr.archived_at IS NULL)
    OR (cc.record_type = 'task' AND t.id IS NOT NULL AND t.archived_at IS NULL)
    OR (cc.record_type = 'document' AND d.id IS NOT NULL AND d.archived_at IS NULL)
    OR (cc.record_type = 'interaction' AND i.id IS NOT NULL AND i.archived_at IS NULL)
    OR (cc.record_type = 'interaction_transcript' AND tr.id IS NOT NULL
        AND transcript_interaction.id IS NOT NULL AND transcript_interaction.archived_at IS NULL)
    OR (cc.record_type = 'ai_note' AND an.id IS NOT NULL AND (
        (an.interaction_id IS NOT NULL
          AND ai_note_interaction.id IS NOT NULL AND ai_note_interaction.archived_at IS NULL)
        OR (an.document_id IS NOT NULL
          AND ai_note_document.id IS NOT NULL AND ai_note_document.archived_at IS NULL)
        OR (an.subject_type = 'person'
          AND ai_note_person.id IS NOT NULL AND ai_note_person.archived_at IS NULL)
        OR (an.subject_type = 'organization'
          AND ai_note_organization.id IS NOT NULL AND ai_note_organization.archived_at IS NULL)
        OR (an.subject_type = 'project'
          AND ai_note_project.id IS NOT NULL AND ai_note_project.archived_at IS NULL)
        OR (an.subject_type = 'task'
          AND ai_note_task.id IS NOT NULL AND ai_note_task.archived_at IS NULL)
        OR (an.subject_type = 'document'
          AND ai_note_document.id IS NOT NULL AND ai_note_document.archived_at IS NULL)
        OR (an.subject_type = 'interaction'
          AND ai_note_interaction.id IS NOT NULL AND ai_note_interaction.archived_at IS NULL)
        OR (an.subject_type = 'asset'
          AND ai_note_asset.id IS NOT NULL AND ai_note_asset.archived_at IS NULL)
        OR (an.subject_type NOT IN ('person', 'organization', 'project', 'task', 'document', 'interaction', 'asset'))
      ))
    OR (cc.record_type = 'extracted_fact' AND ef.id IS NOT NULL AND ef.archived_at IS NULL)
    OR (cc.record_type = 'memory' AND m.id IS NOT NULL AND m.archived_at IS NULL)
    OR (cc.record_type = 'asset' AND a.id IS NOT NULL AND a.archived_at IS NULL)
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

/** Existing detail surface that should open for a chunk-backed source. */
export const chunkNavigationRecordType = sql`CASE
    WHEN cc.record_type IN ('person', 'organization', 'project', 'task', 'document', 'interaction', 'asset')
      THEN cc.record_type
    WHEN cc.record_type = 'organization_profile' THEN 'organization'
    WHEN cc.record_type = 'interaction_transcript' THEN 'interaction'
    WHEN cc.record_type = 'ai_note' AND an.interaction_id IS NOT NULL AND an.document_id IS NULL
      THEN 'interaction'
    WHEN cc.record_type = 'ai_note' AND an.document_id IS NOT NULL AND an.interaction_id IS NULL
      THEN 'document'
    WHEN cc.record_type = 'ai_note'
      AND an.subject_type IN ('person', 'organization', 'project', 'task', 'document', 'interaction', 'asset')
      THEN an.subject_type
    WHEN cc.record_type = 'extracted_fact'
      AND ef.source_record_type IN ('person', 'organization', 'project', 'task', 'document', 'interaction', 'asset')
      THEN ef.source_record_type
    WHEN cc.record_type = 'extracted_fact'
      AND ef.subject_type IN ('person', 'organization', 'project', 'task', 'document', 'interaction', 'asset')
      THEN ef.subject_type
    ELSE NULL
  END`

/** Record id paired with {@link chunkNavigationRecordType}. */
export const chunkNavigationRecordId = sql`CASE
    WHEN cc.record_type IN ('person', 'organization', 'project', 'task', 'document', 'interaction', 'asset')
      THEN cc.record_id
    WHEN cc.record_type = 'organization_profile' THEN op.organization_id
    WHEN cc.record_type = 'interaction_transcript' THEN tr.interaction_id
    WHEN cc.record_type = 'ai_note' AND an.interaction_id IS NOT NULL AND an.document_id IS NULL
      THEN an.interaction_id
    WHEN cc.record_type = 'ai_note' AND an.document_id IS NOT NULL AND an.interaction_id IS NULL
      THEN an.document_id
    WHEN cc.record_type = 'ai_note'
      AND an.subject_type IN ('person', 'organization', 'project', 'task', 'document', 'interaction', 'asset')
      THEN an.subject_id
    WHEN cc.record_type = 'extracted_fact'
      AND ef.source_record_type IN ('person', 'organization', 'project', 'task', 'document', 'interaction', 'asset')
      THEN ef.source_record_id
    WHEN cc.record_type = 'extracted_fact'
      AND ef.subject_type IN ('person', 'organization', 'project', 'task', 'document', 'interaction', 'asset')
      THEN ef.subject_id
    ELSE NULL
  END`

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
    tr.transcribed_at,
    d.occurred_at,
    d.authored_at,
    t.due_at,
    t.scheduled_for,
    pr.completed_on,
    pr.target_date,
    op.researched_at,
    an.generated_at,
    ef.observed_at,
    m.valid_from,
    p.last_interaction_at,
    d.updated_at,
    i.updated_at,
    tr.updated_at,
    transcript_interaction.updated_at,
    p.updated_at,
    o.updated_at,
    op.updated_at,
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
  /**
   * Optional exact record-key allow-list (`recordType:recordId`). An empty list
   * intentionally matches nothing. Record-level retrieval resolves typed
   * relationship filters into this list before any candidate LIMIT is applied.
   */
  recordKeys?: readonly string[]
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
  if (filters.recordKeys !== undefined) {
    if (filters.recordKeys.length === 0) {
      clauses.push(sql`0`)
    } else {
      const recordsByType = new Map<string, string[]>()
      for (const key of filters.recordKeys) {
        const separator = key.indexOf(':')
        const recordType = key.slice(0, separator)
        const ids = recordsByType.get(recordType) ?? []
        ids.push(key.slice(separator + 1))
        recordsByType.set(recordType, ids)
      }
      clauses.push(
        sql`(${sql.join(
          [...recordsByType].map(
            ([recordType, ids]) =>
              sql`(cc.record_type = ${recordType} AND cc.record_id IN (${sql.join(ids.map((id) => sql`${id}`))}))`,
          ),
          sql` OR `,
        )})`,
      )
    }
  }
  if (clauses.length === 0) return sql``
  return sql`AND ${sql.join(clauses, sql` AND `)}`
}
