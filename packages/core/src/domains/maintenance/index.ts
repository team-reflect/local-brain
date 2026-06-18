import { db } from '../../db/client'
import { batch, executeRaw } from '../../db/commands'

/**
 * Destructive-operation maintenance (Plan 08 step 4–5).
 *
 * Archiving is the default (the per-domain `archive*` setters soft-delete by
 * setting `archived_at`). Hard delete is explicit and predictable here: join
 * tables, `memory_links`, and `evidence_refs` cascade via the schema; for
 * documents/interactions we also drop the derived `content_chunks` (which the
 * FTS triggers keep in sync), so no orphaned derived data survives.
 *
 * Derived search data can always be rebuilt from durable rows via
 * {@link rebuildSearchIndexes} — call it after a bulk destructive operation.
 */

export type DeletableKind = 'person' | 'organization' | 'project' | 'task' | 'document' | 'interaction'

const TABLE: Record<DeletableKind, 'people' | 'organizations' | 'projects' | 'tasks' | 'documents' | 'interactions'> = {
  person: 'people',
  organization: 'organizations',
  project: 'projects',
  task: 'tasks',
  document: 'documents',
  interaction: 'interactions',
}

/**
 * Permanently delete a record and its derived data, atomically. Cascades handle
 * typed links; for source records we delete `content_chunks` first so their FTS
 * rows and any `evidence_refs` into them are cleaned up too.
 */
export async function hardDeleteRecord(kind: DeletableKind, id: string): Promise<void> {
  const table = TABLE[kind]
  if (kind === 'document' || kind === 'interaction') {
    await batch([
      db.deleteFrom('contentChunks').where('recordType', '=', kind).where('recordId', '=', id),
      db.deleteFrom(table).where('id', '=', id),
    ])
  } else {
    await batch([db.deleteFrom(table).where('id', '=', id)])
  }
}

/**
 * Rebuild the FTS5 indexes from the durable content (documents, interactions,
 * content_chunks). Safe to run any time; derived indexes are disposable.
 */
export async function rebuildSearchIndexes(): Promise<void> {
  await executeRaw("INSERT INTO documents_fts(documents_fts) VALUES('rebuild')")
  await executeRaw("INSERT INTO interactions_fts(interactions_fts) VALUES('rebuild')")
  await executeRaw("INSERT INTO content_chunks_fts(content_chunks_fts) VALUES('rebuild')")
}
