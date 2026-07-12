import { db, dbForDatabase } from '../../db/client'
import { batch, executeRaw } from '../../db/commands'
import { embedDatabaseIdentity, embedDelete } from '../../embeddings/commands'

/**
 * Destructive-operation maintenance (Plan 08 step 4–5).
 *
 * Archiving is the default (the per-domain `archive*` setters soft-delete by
 * setting `archived_at`). Hard delete is explicit and predictable here. Typed
 * join tables cascade, while generic target tables and subject-derived rows are
 * cleaned explicitly because SQLite cannot attach a foreign key to a
 * `(record_type, record_id)` pair. Every deletable record can own derived
 * `content_chunks`; organizations, interactions, and documents can also
 * cascade child records whose chunks have no foreign key. We drop all of those
 * chunks (which keeps FTS in sync) plus their embedding projection
 * (`chunk_embeddings` + `chunk_vectors`, which have no FK cascade), so no
 * orphaned derived data survives.
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

interface RecordTarget {
  recordType: string
  recordIds: string[]
}

interface DeletePlan {
  targets: RecordTarget[]
  aiNoteIds: string[]
  extractedFactIds: string[]
}

function addTargets(
  targets: Map<string, Set<string>>,
  recordType: string,
  recordIds: readonly string[],
): void {
  addNewTargets(targets, recordType, recordIds)
}

function addNewTargets(
  targets: Map<string, Set<string>>,
  recordType: string,
  recordIds: readonly string[],
): string[] {
  if (recordIds.length === 0) return []
  const ids = targets.get(recordType) ?? new Set<string>()
  const added: string[] = []
  for (const recordId of recordIds) {
    if (ids.has(recordId)) continue
    ids.add(recordId)
    added.push(recordId)
  }
  targets.set(recordType, ids)
  return added
}

function targetList(targets: ReadonlyMap<string, ReadonlySet<string>>): RecordTarget[] {
  return [...targets].map(([recordType, recordIds]) => ({
    recordType,
    recordIds: [...recordIds],
  }))
}

async function buildDeletePlan(
  kind: DeletableKind,
  id: string,
  identity: Awaited<ReturnType<typeof embedDatabaseIdentity>>,
): Promise<DeletePlan> {
  const primaryTargets = new Map<string, Set<string>>()
  addTargets(primaryTargets, kind, [id])
  const readDb = dbForDatabase(identity)

  if (kind === 'organization') {
    const profiles = await readDb
      .selectFrom('organizationProfiles')
      .select('id')
      .where('organizationId', '=', id)
      .execute()
    addTargets(primaryTargets, 'organization_profile', profiles.map((row) => row.id))
  }

  if (kind === 'interaction') {
    const transcripts = await readDb
      .selectFrom('interactionTranscripts')
      .select('id')
      .where('interactionId', '=', id)
      .execute()
    addTargets(primaryTargets, 'interaction_transcript', transcripts.map((row) => row.id))
  }

  const allTargets = new Map<string, Set<string>>()
  for (const target of targetList(primaryTargets)) {
    addTargets(allTargets, target.recordType, target.recordIds)
  }
  const aiNoteIds = new Set<string>()
  const extractedFactIds = new Set<string>()

  if (kind === 'interaction' || kind === 'document') {
    const sourceNotes = kind === 'interaction'
      ? await readDb.selectFrom('aiNotes').select('id').where('interactionId', '=', id).execute()
      : await readDb.selectFrom('aiNotes').select('id').where('documentId', '=', id).execute()
    for (const note of sourceNotes) aiNoteIds.add(note.id)
    addTargets(allTargets, 'ai_note', sourceNotes.map((note) => note.id))
  }

  // AI notes and extracted facts may themselves be subjects of further
  // artifacts. Walk that finite graph to a fixed point so deleting a primary
  // record cannot leave a nested artifact (and its chunks/vectors) dangling.
  // The target sets also make cycles harmless.
  let frontier = targetList(allTargets)
  while (frontier.length > 0) {
    const subjectRows = await Promise.all(
      frontier.map(async (target) => {
        const [notes, facts] = await Promise.all([
          readDb
            .selectFrom('aiNotes')
            .select('id')
            .where('subjectType', '=', target.recordType)
            .where('subjectId', 'in', target.recordIds)
            .execute(),
          readDb
            .selectFrom('extractedFacts')
            .select('id')
            .where('subjectType', '=', target.recordType)
            .where('subjectId', 'in', target.recordIds)
            .execute(),
        ])
        return { notes, facts }
      }),
    )
    const nextTargets = new Map<string, Set<string>>()
    for (const row of subjectRows) {
      const newNoteIds = addNewTargets(
        allTargets,
        'ai_note',
        row.notes.map((note) => note.id),
      )
      const newFactIds = addNewTargets(
        allTargets,
        'extracted_fact',
        row.facts.map((fact) => fact.id),
      )
      for (const noteId of newNoteIds) aiNoteIds.add(noteId)
      for (const factId of newFactIds) extractedFactIds.add(factId)
      addTargets(nextTargets, 'ai_note', newNoteIds)
      addTargets(nextTargets, 'extracted_fact', newFactIds)
    }
    frontier = targetList(nextTargets)
  }

  return {
    targets: targetList(allTargets),
    aiNoteIds: [...aiNoteIds],
    extractedFactIds: [...extractedFactIds],
  }
}

/**
 * Permanently delete a record and its derived data. Cascades handle typed links;
 * for source records we delete `content_chunks` (so their FTS rows and any
 * `evidence_refs` into them are cleaned up too) plus their embedding projection.
 * The embedding projection has no FK to `content_chunks` (the pipeline owns its
 * lifecycle, so a chunk rewrite can't silently cascade-delete vectors
 * mid-rebuild), so it lives in a separate IPC transaction — `db_batch` can't
 * express the vec0 rowid coupling — and must be pruned explicitly via
 * `embedDelete`, otherwise orphaned vec0 rows linger and waste KNN slots.
 *
 * The two writes can't share a transaction, so we order them for safe failure:
 * `embedDelete` runs *before* the `content_chunks`/source `db_batch`. If the
 * embedding prune throws, the durable rows are untouched and the delete is
 * simply retryable — never a committed source delete with orphaned vectors still
 * answering KNN. If the prune succeeds but the batch then throws, the chunks
 * survive without vectors and the idempotent backfill re-embeds them; no orphan
 * lingers either way.
 */
export async function hardDeleteRecord(kind: DeletableKind, id: string): Promise<void> {
  const table = TABLE[kind]
  const identity = await embedDatabaseIdentity()
  const plan = await buildDeletePlan(kind, id, identity)
  const readDb = dbForDatabase(identity)
  const chunkLists = await Promise.all(
    plan.targets.map((target) =>
      readDb
        .selectFrom('contentChunks')
        .select('id')
        .where('recordType', '=', target.recordType)
        .where('recordId', 'in', target.recordIds)
        .execute(),
    ),
  )
  const chunkIds = [...new Set(chunkLists.flat().map((chunk) => chunk.id))]

  // Prune the embedding projection first: a failure here leaves the durable
  // rows intact and retryable rather than committing the source delete and
  // stranding orphaned vec0 rows that can still surface in KNN.
  if (chunkIds.length > 0) {
    await embedDelete(identity, chunkIds)
  }
  await batch([
    ...plan.targets.flatMap((target) => [
      db
        .deleteFrom('memoryLinks')
        .where('recordType', '=', target.recordType)
        .where('recordId', 'in', target.recordIds),
      db
        .deleteFrom('assetLinks')
        .where('recordType', '=', target.recordType)
        .where('recordId', 'in', target.recordIds),
      db
        .deleteFrom('evidenceRefs')
        .where('subjectType', '=', target.recordType)
        .where('subjectId', 'in', target.recordIds),
      db
        .deleteFrom('taggings')
        .where('recordType', '=', target.recordType)
        .where('recordId', 'in', target.recordIds),
      db
        .deleteFrom('externalIdentities')
        .where('entityType', '=', target.recordType)
        .where('entityId', 'in', target.recordIds),
      db
        .deleteFrom('recordProvenance')
        .where('recordType', '=', target.recordType)
        .where('recordId', 'in', target.recordIds),
      db
        .deleteFrom('suggestionLinks')
        .where('recordType', '=', target.recordType)
        .where('recordId', 'in', target.recordIds),
      db
        .updateTable('suggestions')
        .set({ resolvedRecordType: null, resolvedRecordId: null })
        .where('resolvedRecordType', '=', target.recordType)
        .where('resolvedRecordId', 'in', target.recordIds),
      // Facts that merely cite the deleted record as their source survive, but
      // the stale pointer and copied excerpt do not.
      db
        .updateTable('extractedFacts')
        .set({ sourceRecordType: null, sourceRecordId: null, sourceExcerpt: null })
        .where('sourceRecordType', '=', target.recordType)
        .where('sourceRecordId', 'in', target.recordIds),
      db
        .updateTable('contentChunks')
        .set({ sourceRecordType: null, sourceRecordId: null })
        .where('sourceRecordType', '=', target.recordType)
        .where('sourceRecordId', 'in', target.recordIds),
      db
        .updateTable('tasks')
        .set({ sourceRecordType: null, sourceRecordId: null })
        .where('sourceRecordType', '=', target.recordType)
        .where('sourceRecordId', 'in', target.recordIds),
    ]),
    ...(plan.aiNoteIds.length > 0
      ? [db.deleteFrom('aiNotes').where('id', 'in', plan.aiNoteIds)]
      : []),
    ...(plan.extractedFactIds.length > 0
      ? [db.deleteFrom('extractedFacts').where('id', 'in', plan.extractedFactIds)]
      : []),
    ...plan.targets.map((target) =>
      db
        .deleteFrom('contentChunks')
        .where('recordType', '=', target.recordType)
        .where('recordId', 'in', target.recordIds),
    ),
    db.deleteFrom(table).where('id', '=', id),
  ], identity)
}

/**
 * Rebuild the FTS5 indexes from the durable content (documents, interactions,
 * content_chunks, assets, asset links, and asset_texts). Safe to run any time;
 * derived indexes are disposable.
 */
export async function rebuildSearchIndexes(): Promise<void> {
  await executeRaw("INSERT INTO documents_fts(documents_fts) VALUES('rebuild')")
  await executeRaw("INSERT INTO interactions_fts(interactions_fts) VALUES('rebuild')")
  await executeRaw("INSERT INTO content_chunks_fts(content_chunks_fts) VALUES('rebuild')")
  await executeRaw('DELETE FROM asset_search')
  await executeRaw(
    'INSERT INTO asset_search (asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at) SELECT asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at FROM asset_search_source',
  )
  await executeRaw("INSERT INTO assets_fts(assets_fts) VALUES('rebuild')")
}
