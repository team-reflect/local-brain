import { sql } from 'kysely'

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
