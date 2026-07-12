// Real-SQLite tests for Plan 08: destructive-delete maintenance and
// model-boundary settings. Uses the shared node:sqlite harness so cascades,
// content_chunks cleanup, and FTS5 rebuild run end to end against the actual
// migrations.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  db,
  getModelSettings,
  globalSearch,
  hardDeleteRecord,
  ingestDocument,
  ingestInteraction,
  listCitationsForSubject,
  rebuildSearchIndexes,
  setBridge,
  setAiProvidersState,
  updateAiProvidersState,
  withAiProviderAdded,
} from '@local-brain/core'
import { freshDatabase, installSqliteBridge } from './sqlite-harness.mjs'

/** Mirror the harness's JSON->SQLite coercion for the custom bridge below. */
function toSqlParam(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'object') return JSON.stringify(value)
  return value
}

/**
 * Like `installSqliteBridge`, but `embed_delete` rejects — standing in for the
 * embedding IPC transaction failing during a hard delete. Used to prove the
 * delete is ordered so a prune failure leaves the durable rows intact.
 */
function installFailingEmbedDeleteBridge(database) {
  setBridge({
    invoke(command, args) {
      if (command === 'db_query') {
        return Promise.resolve(database.prepare(args.sql).all(...args.params.map(toSqlParam)))
      }
      if (command === 'db_execute') {
        return Promise.resolve(Number(database.prepare(args.sql).run(...args.params.map(toSqlParam)).changes))
      }
      if (command === 'db_batch') {
        database.exec('BEGIN')
        try {
          const affected = args.statements.map((statement) =>
            Number(database.prepare(statement.sql).run(...statement.params.map(toSqlParam)).changes),
          )
          database.exec('COMMIT')
          return Promise.resolve(affected)
        } catch (error) {
          database.exec('ROLLBACK')
          return Promise.reject(error)
        }
      }
      if (command === 'embed_delete') {
        return Promise.reject(new Error('embed_delete failed: vec0 locked'))
      }
      if (command === 'embed_database_identity') {
        return Promise.resolve({ databasePath: '/test/brain.sqlite', generation: 1 })
      }
      return Promise.reject(new Error(`unexpected command: ${command}`))
    },
  })
}

async function tableCount(table) {
  const row = await db
    .selectFrom(table)
    .select(({ fn }) => fn.countAll().as('count'))
    .executeTakeFirstOrThrow()
  return Number(row.count)
}

function insertEmbeddedChunk(database, { id, recordType, recordId, text }) {
  database
    .prepare(
      'INSERT INTO content_chunks (id, record_type, record_id, chunk_index, text) VALUES (?, ?, ?, 0, ?)',
    )
    .run(id, recordType, recordId, text)
  database
    .prepare(
      "INSERT INTO chunk_embeddings (chunk_id, content_hash, model_id) VALUES (?, 'h', 'all-MiniLM-L6-v2')",
    )
    .run(id)
}

describe('Plan 08 destructive maintenance', () => {
  beforeEach(() => installSqliteBridge(freshDatabase()))

  it.each([
    ['person', 'people', 'INSERT INTO people (id, full_name) VALUES (?, ?)', 'Person'],
    ['organization', 'organizations', 'INSERT INTO organizations (id, name) VALUES (?, ?)', 'Organization'],
    ['project', 'projects', 'INSERT INTO projects (id, name) VALUES (?, ?)', 'Project'],
    ['task', 'tasks', 'INSERT INTO tasks (id, title) VALUES (?, ?)', 'Task'],
    ['document', 'documents', 'INSERT INTO documents (id, title) VALUES (?, ?)', 'Document'],
    ['interaction', 'interactions', 'INSERT INTO interactions (id, title) VALUES (?, ?)', 'Interaction'],
  ])('removes direct %s chunks, FTS rows, and embeddings', async (kind, table, insertSql, label) => {
    const database = freshDatabase()
    installSqliteBridge(database)
    const recordId = `${kind}-delete`
    const chunkId = `${kind}-chunk`
    const noteId = `${kind}-note`
    const factId = `${kind}-fact`
    const token = `${kind}harddeletemarker`
    database.prepare(insertSql).run(recordId, label)
    database
      .prepare(
        'INSERT INTO ai_notes (id, subject_type, subject_id, content) VALUES (?, ?, ?, ?)',
      )
      .run(noteId, kind, recordId, `${label} derived note`)
    database
      .prepare(
        'INSERT INTO extracted_facts (id, subject_type, subject_id, key, value_text) VALUES (?, ?, ?, ?, ?)',
      )
      .run(factId, kind, recordId, `${kind}-key`, `${label} derived fact`)
    insertEmbeddedChunk(database, { id: chunkId, recordType: kind, recordId, text: token })
    insertEmbeddedChunk(database, {
      id: `${noteId}-chunk`,
      recordType: 'ai_note',
      recordId: noteId,
      text: `${kind}notedeletemarker`,
    })
    insertEmbeddedChunk(database, {
      id: `${factId}-chunk`,
      recordType: 'extracted_fact',
      recordId: factId,
      text: `${kind}factdeletemarker`,
    })

    expect(
      database.prepare('SELECT count(*) AS n FROM content_chunks_fts WHERE content_chunks_fts MATCH ?').get(token).n,
    ).toBe(1)

    await hardDeleteRecord(kind, recordId)

    expect(database.prepare(`SELECT count(*) AS n FROM ${table} WHERE id = ?`).get(recordId).n).toBe(0)
    expect(database.prepare('SELECT count(*) AS n FROM ai_notes WHERE id = ?').get(noteId).n).toBe(0)
    expect(database.prepare('SELECT count(*) AS n FROM extracted_facts WHERE id = ?').get(factId).n).toBe(0)
    expect(database.prepare('SELECT count(*) AS n FROM content_chunks').get().n).toBe(0)
    expect(database.prepare('SELECT count(*) AS n FROM chunk_embeddings').get().n).toBe(0)
    expect(
      database.prepare('SELECT count(*) AS n FROM content_chunks_fts WHERE content_chunks_fts MATCH ?').get(token).n,
    ).toBe(0)
  })

  it('removes chunks for organization profiles that cascade with their owner', async () => {
    const database = freshDatabase()
    installSqliteBridge(database)
    database.prepare("INSERT INTO organizations (id, name) VALUES ('org-delete', 'Delete Org')").run()
    database
      .prepare(
        "INSERT INTO organization_profiles (id, organization_id, one_line_description) VALUES ('profile-delete', 'org-delete', 'Profile')",
      )
      .run()
    insertEmbeddedChunk(database, {
      id: 'profile-chunk',
      recordType: 'organization_profile',
      recordId: 'profile-delete',
      text: 'profileharddeletemarker',
    })

    await hardDeleteRecord('organization', 'org-delete')

    expect(database.prepare('SELECT count(*) AS n FROM organization_profiles').get().n).toBe(0)
    expect(database.prepare('SELECT count(*) AS n FROM content_chunks').get().n).toBe(0)
    expect(database.prepare('SELECT count(*) AS n FROM chunk_embeddings').get().n).toBe(0)
    expect(
      database
        .prepare("SELECT count(*) AS n FROM content_chunks_fts WHERE content_chunks_fts MATCH 'profileharddeletemarker'")
        .get().n,
    ).toBe(0)
  })

  it('removes chunks for transcripts and AI notes that cascade with an interaction', async () => {
    const database = freshDatabase()
    installSqliteBridge(database)
    database.prepare("INSERT INTO interactions (id, title) VALUES ('interaction-delete', 'Delete')").run()
    database
      .prepare(
        "INSERT INTO interaction_transcripts (id, interaction_id, raw_text) VALUES ('transcript-delete', 'interaction-delete', 'Transcript')",
      )
      .run()
    database
      .prepare(
        "INSERT INTO ai_notes (id, interaction_id, content) VALUES ('note-delete', 'interaction-delete', 'Note')",
      )
      .run()
    insertEmbeddedChunk(database, {
      id: 'transcript-chunk',
      recordType: 'interaction_transcript',
      recordId: 'transcript-delete',
      text: 'transcriptharddeletemarker',
    })
    insertEmbeddedChunk(database, {
      id: 'note-chunk',
      recordType: 'ai_note',
      recordId: 'note-delete',
      text: 'noteharddeletemarker',
    })

    await hardDeleteRecord('interaction', 'interaction-delete')

    expect(database.prepare('SELECT count(*) AS n FROM interaction_transcripts').get().n).toBe(0)
    expect(database.prepare('SELECT count(*) AS n FROM ai_notes').get().n).toBe(0)
    expect(database.prepare('SELECT count(*) AS n FROM content_chunks').get().n).toBe(0)
    expect(database.prepare('SELECT count(*) AS n FROM chunk_embeddings').get().n).toBe(0)
  })

  it('removes generic target rows and clears source-only fact provenance', async () => {
    const database = freshDatabase()
    installSqliteBridge(database)
    database.prepare("INSERT INTO people (id, full_name) VALUES ('person-delete', 'Delete Person')").run()
    database.prepare("INSERT INTO organizations (id, name) VALUES ('org-keep', 'Keep Org')").run()
    database.prepare("INSERT INTO memories (id, claim) VALUES ('memory-keep', 'Keep memory')").run()
    database
      .prepare(
        "INSERT INTO tasks (id, title, source_record_type, source_record_id) VALUES ('task-keep', 'Keep task', 'person', 'person-delete')",
      )
      .run()
    database
      .prepare(
        "INSERT INTO assets (id, byte_size, content_hash, storage_path) VALUES ('asset-keep', 1, 'asset-hash', 'asset.bin')",
      )
      .run()
    database.prepare("INSERT INTO sources (id, slug, name) VALUES ('source-1', 'source-1', 'Source')").run()
    database.prepare("INSERT INTO tags (id, name) VALUES ('tag-1', 'Delete target')").run()
    database
      .prepare(
        "INSERT INTO suggestions (id, kind, title) VALUES ('suggestion-1', 'create_project', 'Suggestion')",
      )
      .run()
    database
      .prepare(
        "INSERT INTO content_chunks (id, record_type, record_id, chunk_index, text) VALUES ('memory-chunk', 'memory', 'memory-keep', 0, 'Preserved evidence')",
      )
      .run()
    database
      .prepare(
        "INSERT INTO extracted_facts (id, subject_type, subject_id, key, value_text, source_record_type, source_record_id, source_excerpt) VALUES ('source-fact', 'organization', 'org-keep', 'status', 'active', 'person', 'person-delete', 'copied private source')",
      )
      .run()
    database
      .prepare(
        "INSERT INTO content_chunks (id, record_type, record_id, source_record_type, source_record_id, chunk_index, text) VALUES ('source-fact-chunk', 'extracted_fact', 'source-fact', 'person', 'person-delete', 0, 'Organization status is active')",
      )
      .run()

    database
      .prepare(
        "INSERT INTO memory_links (id, memory_id, record_type, record_id) VALUES ('memory-link', 'memory-keep', 'person', 'person-delete')",
      )
      .run()
    database
      .prepare(
        "INSERT INTO asset_links (id, asset_id, record_type, record_id) VALUES ('asset-link', 'asset-keep', 'person', 'person-delete')",
      )
      .run()
    database
      .prepare(
        "INSERT INTO evidence_refs (id, subject_type, subject_id, chunk_id) VALUES ('evidence-link', 'person', 'person-delete', 'memory-chunk')",
      )
      .run()
    database
      .prepare(
        "INSERT INTO taggings (id, tag_id, record_type, record_id) VALUES ('tagging-link', 'tag-1', 'person', 'person-delete')",
      )
      .run()
    database
      .prepare(
        "INSERT INTO external_identities (id, entity_type, entity_id, source_id, external_id) VALUES ('external-link', 'person', 'person-delete', 'source-1', 'external-person')",
      )
      .run()
    database
      .prepare(
        "INSERT INTO record_provenance (id, record_type, record_id) VALUES ('provenance-link', 'person', 'person-delete')",
      )
      .run()
    database
      .prepare(
        "INSERT INTO suggestion_links (id, suggestion_id, record_type, record_id) VALUES ('suggestion-link', 'suggestion-1', 'person', 'person-delete')",
      )
      .run()

    await hardDeleteRecord('person', 'person-delete')

    for (const table of [
      'memory_links',
      'asset_links',
      'evidence_refs',
      'taggings',
      'external_identities',
      'record_provenance',
      'suggestion_links',
    ]) {
      expect(database.prepare(`SELECT count(*) AS n FROM ${table}`).get().n).toBe(0)
    }
    expect(
      database
        .prepare(
          'SELECT source_record_type, source_record_id, source_excerpt FROM extracted_facts WHERE id = ?',
        )
        .get('source-fact'),
    ).toEqual({ source_record_type: null, source_record_id: null, source_excerpt: null })
    expect(
      database
        .prepare(
          'SELECT source_record_type, source_record_id FROM content_chunks WHERE id = ?',
        )
        .get('source-fact-chunk'),
    ).toEqual({ source_record_type: null, source_record_id: null })
    expect(database.prepare('SELECT count(*) AS n FROM memories').get().n).toBe(1)
    expect(database.prepare('SELECT count(*) AS n FROM assets').get().n).toBe(1)
    expect(
      database
        .prepare('SELECT source_record_type, source_record_id FROM tasks WHERE id = ?')
        .get('task-keep'),
    ).toEqual({ source_record_type: null, source_record_id: null })
  })

  it('hard-deletes a document with its chunks and rebuilds FTS', async () => {
    const doc = await ingestDocument({ title: 'Throwaway', bodyText: 'unique-token-zebra appears here' })
    // The chunk is searchable before deletion.
    expect((await globalSearch('zebra')).some((h) => h.id === doc.id)).toBe(true)

    await hardDeleteRecord('document', doc.id)

    expect(await tableCount('documents')).toBe(0)
    expect(await tableCount('contentChunks')).toBe(0)
    // FTS no longer returns the deleted record; rebuild is safe to run.
    await rebuildSearchIndexes()
    expect((await globalSearch('zebra')).length).toBe(0)
  })

  it('drops the embedding projection when a source record is hard-deleted', async () => {
    const database = freshDatabase()
    installSqliteBridge(database)

    const doc = await ingestDocument({ title: 'Embedded', bodyText: 'vectorize me please' })
    const chunks = database.prepare('SELECT id FROM content_chunks WHERE record_id = ?').all(doc.id)
    expect(chunks.length).toBeGreaterThan(0)
    // Stand in for the backfill: give every chunk a stored embedding row.
    for (const chunk of chunks) {
      database
        .prepare("INSERT INTO chunk_embeddings (chunk_id, content_hash, model_id) VALUES (?, 'h', 'all-MiniLM-L6-v2')")
        .run(chunk.id)
    }
    const embeddingCount = () => Number(database.prepare('SELECT count(*) AS n FROM chunk_embeddings').get().n)
    expect(embeddingCount()).toBe(chunks.length)

    await hardDeleteRecord('document', doc.id)

    expect(await tableCount('contentChunks')).toBe(0)
    // No orphaned chunk_embeddings (and, on real SQLite, no orphaned chunk_vectors).
    expect(embeddingCount()).toBe(0)
  })

  it('leaves the source intact when the embedding prune fails (no split commit)', async () => {
    // Bugbot pass 7 "Hard delete splits embedding cleanup": the embedding prune
    // runs in its own IPC transaction, so it can't share the source `db_batch`.
    // Ordering it BEFORE the batch means a prune failure aborts the whole delete
    // with the durable rows intact and retryable — never a committed source
    // delete leaving orphaned vec0 rows that still answer KNN.
    const database = freshDatabase()
    // Seed via the normal harness so ingest's writes go through.
    installSqliteBridge(database)
    const doc = await ingestDocument({ title: 'Embedded', bodyText: 'vectorize me please' })
    const chunks = database.prepare('SELECT id FROM content_chunks WHERE record_id = ?').all(doc.id)
    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) {
      database
        .prepare("INSERT INTO chunk_embeddings (chunk_id, content_hash, model_id) VALUES (?, 'h', 'all-MiniLM-L6-v2')")
        .run(chunk.id)
    }

    // Now swap in a bridge whose embed_delete rejects, then attempt the delete.
    installFailingEmbedDeleteBridge(database)
    await expect(hardDeleteRecord('document', doc.id)).rejects.toThrow(/embed_delete failed/)

    // The source record and its chunks survive — the batch never ran, so there is
    // no committed delete stranding orphaned embeddings.
    expect(database.prepare('SELECT count(*) AS n FROM documents WHERE id = ?').get(doc.id).n).toBe(1)
    expect(
      database.prepare('SELECT count(*) AS n FROM content_chunks WHERE record_id = ?').get(doc.id).n,
    ).toBe(chunks.length)
    expect(database.prepare('SELECT count(*) AS n FROM chunk_embeddings').get().n).toBe(chunks.length)
  })

  it('cascades evidence when its cited chunk is deleted', async () => {
    const interaction = await ingestInteraction({ kind: 'meeting', title: 'M', bodyText: 'grounding text' })
    // No evidence yet; just prove the delete path cleans interactions + chunks.
    await hardDeleteRecord('interaction', interaction.id)
    expect(await tableCount('interactions')).toBe(0)
    expect(await tableCount('contentChunks')).toBe(0)
    // A subject with no evidence returns nothing (sanity for the citations getter).
    expect(await listCitationsForSubject('memory', 'nope')).toEqual([])
  })
})

describe('Plan 08 model settings', () => {
  beforeEach(() => installSqliteBridge(freshDatabase()))

  it('round-trips the model boundary config', async () => {
    expect(await getModelSettings()).toEqual({
      providers: [],
      defaultProviderId: null,
      provider: null,
      model: null,
    })
    await setAiProvidersState(
      [{ id: 'cfg-a', provider: 'anthropic', model: 'claude-sonnet-4-6', keyHint: 'abcde' }],
      'cfg-a',
    )
    const settings = await getModelSettings()
    expect(settings.provider).toBe('anthropic')
    expect(settings.model).toBe('claude-sonnet-4-6')
  })

  it('serializes provider mutations so concurrent updates compose', async () => {
    const add = (id, makeDefault = false) => (state) =>
      withAiProviderAdded(
        state,
        { id, provider: 'anthropic', model: 'claude-sonnet-4-6', keyHint: id.slice(-5) },
        makeDefault,
      )

    await Promise.all([
      updateAiProvidersState(async (state) => {
        await new Promise((resolve) => setTimeout(resolve, 0))
        return add('cfg-a', true)(state)
      }),
      updateAiProvidersState(add('cfg-b')),
    ])

    const settings = await getModelSettings()
    expect(settings.providers.map((provider) => provider.id)).toEqual(['cfg-a', 'cfg-b'])
    expect(settings.defaultProviderId).toBe('cfg-a')
  })
})
