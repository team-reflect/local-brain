import { db, dbForDatabase } from '../db/client'
import type { DatabaseIdentity } from '../db/identity'
import { squish } from '../text/normalize'
import type { LinkEntityType, LinkSource } from './source-links'

/**
 * Store-facing helpers for {@link applyExtraction}: the pre-apply reads it needs
 * to merge deterministically (source chunks, prior affiliations/tasks/memory
 * claims). The source-record ↔ entity join topology (loading existing links and
 * building the link inserts) lives in {@link ./source-links}, shared with
 * ingestion; this file re-exports it so apply callers have one import.
 */

export {
  loadSourceLinks,
  sourceLinkStatement,
  type SourceLinks,
  type LinkEntityType,
} from './source-links'

/** The source record an extraction result is being applied to. */
export type ApplySource = LinkSource

/** A typed entity the model resolved to an existing-or-new row. */
export type EntityType = LinkEntityType

export interface Resolved {
  type: EntityType
  id: string
}

/** Map a source record's chunk indexes to chunk ids, for resolving evidence refs. */
export async function loadChunkMap(
  source: ApplySource,
  databaseIdentity?: DatabaseIdentity,
): Promise<Map<number, string>> {
  const rows = await (databaseIdentity ? dbForDatabase(databaseIdentity) : db)
    .selectFrom('contentChunks')
    .select(['chunkIndex', 'id'])
    .where('recordType', '=', source.recordType)
    .where('recordId', '=', source.recordId)
    .execute()
  return new Map(rows.map((row) => [row.chunkIndex, row.id]))
}

/** Existing `person:organization` affiliation pairs for the given people. */
export async function loadAffiliationPairs(
  personIds: readonly string[],
  databaseIdentity?: DatabaseIdentity,
): Promise<Set<string>> {
  if (personIds.length === 0) return new Set()
  const rows = await (databaseIdentity ? dbForDatabase(databaseIdentity) : db)
    .selectFrom('affiliations')
    .select(['personId', 'organizationId'])
    .where('personId', 'in', personIds)
    .execute()
  return new Set(rows.map((row) => `${row.personId}:${row.organizationId}`))
}

/** Non-archived tasks as `{id, title}` candidates for duplicate-title avoidance. */
export function loadTaskCandidates(
  databaseIdentity?: DatabaseIdentity,
): Promise<{ id: string; title: string }[]> {
  return (databaseIdentity ? dbForDatabase(databaseIdentity) : db)
    .selectFrom('tasks')
    .where('archivedAt', 'is', null)
    .select(['id', 'title'])
    .execute()
}

/** Normalized claim text of every non-archived memory, for duplicate avoidance. */
export async function loadMemoryClaims(databaseIdentity?: DatabaseIdentity): Promise<Set<string>> {
  const rows = await (databaseIdentity ? dbForDatabase(databaseIdentity) : db)
    .selectFrom('memories')
    .where('archivedAt', 'is', null)
    .select('claim')
    .execute()
  return new Set(rows.map((row) => squish(row.claim).toLowerCase()))
}
