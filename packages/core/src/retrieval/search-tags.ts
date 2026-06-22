import { sql, type RawBuilder } from 'kysely'
import { db } from '../db/client'
import type { RecordKind } from '../domains/relations/types'

/**
 * Tag-aware recall for global search: exact `#tag` filter clauses, a cheap
 * "does any tag match this text" pre-check, and the tagged-record lookup over
 * every navigable kind.
 *
 * Mirrored in Rust by `tag_filter_sql`, `should_search_tag_hits`, and
 * `tag_hits` in apps/cli/src/commands/read.rs — the `records` CTE and tag-label
 * subquery are duplicated verbatim, so keep the two in sync.
 */

export interface TagRecordRow {
  kind: RecordKind
  id: string
  title: string | null
  subtitle: string | null
  snippet: string | null
  recordDate: string | null
}

export function tagFilterClauses(
  recordType: RecordKind,
  recordId: RawBuilder<unknown>,
  tagFilters: readonly string[],
): RawBuilder<unknown> {
  if (tagFilters.length === 0) return sql``
  const clauses = tagFilters.map((tag) => tagFilterExists(sql`${recordType}`, recordId, tag))
  return sql`AND ${sql.join(clauses, sql` AND `)}`
}

export async function shouldSearchTaggedRecords(options: {
  hasText: boolean
  tagFilters: readonly string[]
  tagLike: string | null
}): Promise<boolean> {
  if (!options.hasText && options.tagFilters.length > 0) return true
  if (!options.tagLike) return false

  const result = await sql<{ hit: number }>`
    SELECT 1 AS "hit"
    FROM tags
    WHERE lower(name) LIKE ${options.tagLike} ESCAPE '\\'
       OR lower(COALESCE(slug, '')) LIKE ${options.tagLike} ESCAPE '\\'
    LIMIT 1
  `.execute(db)
  return result.rows.length > 0
}

export async function taggedRecordRows(options: {
  tagFilters: readonly string[]
  tagLike: string | null
  limit: number
  kinds?: readonly RecordKind[]
}): Promise<TagRecordRow[]> {
  const result = await sql<TagRecordRow>`
    WITH records(kind, id, title, subtitle, record_date) AS (
      SELECT 'person', id, full_name, headline, updated_at
      FROM people
      WHERE archived_at IS NULL
      UNION ALL
      SELECT 'organization', id, name, kind, updated_at
      FROM organizations
      WHERE archived_at IS NULL
      UNION ALL
      SELECT 'project', id, name, status, updated_at
      FROM projects
      WHERE archived_at IS NULL
      UNION ALL
      SELECT 'task', id, title, status, COALESCE(due_at, scheduled_for, updated_at)
      FROM tasks
      WHERE archived_at IS NULL
      UNION ALL
      SELECT 'document', id, title, kind, updated_at
      FROM documents
      WHERE archived_at IS NULL
      UNION ALL
      SELECT 'interaction', id, title, kind, COALESCE(occurred_at, updated_at)
      FROM interactions
      WHERE archived_at IS NULL
      UNION ALL
      SELECT 'asset',
             id,
             COALESCE(NULLIF(trim(original_filename), ''), storage_path),
             COALESCE(NULLIF(trim(mime_type), ''), NULLIF(trim(kind), '')),
             updated_at
      FROM assets
      WHERE archived_at IS NULL
    )
    SELECT
      records.kind AS "kind",
      records.id AS "id",
      records.title AS "title",
      records.subtitle AS "subtitle",
      (
        SELECT 'Tagged #' || group_concat(label, ', #')
        FROM (
          SELECT DISTINCT COALESCE(NULLIF(trim(tags.slug), ''), tags.name) AS label
          FROM taggings
          JOIN tags ON tags.id = taggings.tag_id
          WHERE taggings.record_type = records.kind
            AND taggings.record_id = records.id
          ORDER BY label ASC
        )
      ) AS "snippet",
      records.record_date AS "recordDate"
    FROM records
    WHERE 1 = 1
      ${wantedKindClause(options.kinds)}
      ${tagFilterClausesForRecords(options.tagFilters)}
      ${tagTextClause(options.tagLike)}
    ORDER BY records.record_date DESC
    LIMIT ${options.limit}
  `.execute(db)

  return result.rows
}

function tagTextClause(tagLike: string | null): RawBuilder<unknown> {
  if (!tagLike) return sql``
  return sql`AND EXISTS (
    SELECT 1
    FROM taggings text_taggings
    JOIN tags text_tags ON text_tags.id = text_taggings.tag_id
    WHERE text_taggings.record_type = records.kind
      AND text_taggings.record_id = records.id
      AND (
        lower(text_tags.name) LIKE ${tagLike} ESCAPE '\\'
        OR lower(COALESCE(text_tags.slug, '')) LIKE ${tagLike} ESCAPE '\\'
      )
  )`
}

function wantedKindClause(kinds: readonly RecordKind[] | undefined): RawBuilder<unknown> {
  if (!kinds || kinds.length === 0) return sql``
  const navigable = kinds.filter((kind) => kind !== 'memory')
  if (navigable.length === 0) return sql`AND 0`
  const values = sql.join(navigable.map((kind) => sql`${kind}`))
  return sql`AND records.kind IN (${values})`
}

function tagFilterClausesForRecords(tagFilters: readonly string[]): RawBuilder<unknown> {
  if (tagFilters.length === 0) return sql``
  const clauses = tagFilters.map((tag) => tagFilterExists(sql`records.kind`, sql`records.id`, tag))
  return sql`AND ${sql.join(clauses, sql` AND `)}`
}

function tagFilterExists(
  recordType: RawBuilder<unknown>,
  recordId: RawBuilder<unknown>,
  tag: string,
): RawBuilder<unknown> {
  return sql`EXISTS (
    SELECT 1
    FROM taggings filter_taggings
    JOIN tags filter_tags ON filter_tags.id = filter_taggings.tag_id
    WHERE filter_taggings.record_type = ${recordType}
      AND filter_taggings.record_id = ${recordId}
      AND (
        lower(COALESCE(filter_tags.slug, filter_tags.name)) = ${tag}
        OR lower(filter_tags.name) = ${tag}
      )
  )`
}
