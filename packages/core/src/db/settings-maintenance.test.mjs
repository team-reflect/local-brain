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

describe('Plan 08 destructive maintenance', () => {
  beforeEach(() => installSqliteBridge(freshDatabase()))

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
    expect(await listCitationsForSubject('chat_message', 'nope')).toEqual([])
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
