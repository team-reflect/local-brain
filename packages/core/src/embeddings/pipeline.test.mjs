// Real-SQLite tests for the embedding backfill pipeline + status (Plan 09).
//
// Uses the shared node:sqlite harness for the durable tables (content_chunks,
// chunk_embeddings — the vec0 chunk_vectors table is stripped, since Node's
// SQLite lacks sqlite-vec) and stubs the Rust embedding runtime at the bridge:
// `embed_texts` returns dummy vectors, `embed_apply` writes chunk_embeddings.
// This exercises the hash-skip incremental logic against real SQL while the
// actual vector math/storage is covered by the Rust tests.

import { afterEach, describe, expect, it } from 'vitest'
import {
  backfillEmbeddings,
  countPending,
  getEmbeddingsStatus,
  ingestDocument,
  pruneOrphanEmbeddings,
  setBridge,
  setEmbeddingsEnabled,
} from '@local-brain/core'
import { freshDatabase } from '../db/sqlite-harness.mjs'

function toSqlParam(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'object') return JSON.stringify(value)
  return value
}

/** A bridge backed by `database` for db_* plus a stubbed embedding runtime. */
function installComboBridge(database) {
  const counters = { embedded: 0 }
  setBridge({
    invoke(command, args) {
      switch (command) {
        case 'db_query':
          return Promise.resolve(database.prepare(args.sql).all(...args.params.map(toSqlParam)))
        case 'db_execute':
          return Promise.resolve(Number(database.prepare(args.sql).run(...args.params.map(toSqlParam)).changes))
        case 'db_batch': {
          database.exec('BEGIN')
          try {
            const affected = args.statements.map((s) =>
              Number(database.prepare(s.sql).run(...s.params.map(toSqlParam)).changes),
            )
            database.exec('COMMIT')
            return Promise.resolve(affected)
          } catch (error) {
            database.exec('ROLLBACK')
            return Promise.reject(error)
          }
        }
        case 'embed_status':
          return Promise.resolve({ status: 'ready', model: 'all-MiniLM-L6-v2' })
        case 'embed_texts':
          return Promise.resolve(args.texts.map(() => new Array(384).fill(0)))
        case 'embed_apply': {
          for (const chunk of args.chunks) {
            database
              .prepare('DELETE FROM chunk_embeddings WHERE chunk_id = ? AND model_id = ?')
              .run(chunk.chunkId, chunk.modelId)
            database
              .prepare('INSERT INTO chunk_embeddings (chunk_id, content_hash, model_id) VALUES (?, ?, ?)')
              .run(chunk.chunkId, chunk.contentHash, chunk.modelId)
            counters.embedded += 1
          }
          return Promise.resolve(args.chunks.length)
        }
        case 'embed_delete': {
          let deleted = 0
          for (const id of args.chunkIds) {
            deleted += Number(database.prepare('DELETE FROM chunk_embeddings WHERE chunk_id = ?').run(id).changes)
          }
          return Promise.resolve(deleted)
        }
        case 'embed_clear':
          return Promise.resolve(Number(database.prepare('DELETE FROM chunk_embeddings').run().changes))
        default:
          return Promise.reject(new Error(`unexpected command: ${command}`))
      }
    },
  })
  return counters
}

/** A body that chunks into three ~900-char paragraphs. */
function threeChunkBody() {
  const paragraph = 'lorem ipsum dolor sit amet '.repeat(34) // ~918 chars
  return [paragraph, paragraph.replace('lorem', 'consectetur'), paragraph.replace('lorem', 'adipiscing')].join('\n\n')
}

describe('embedding backfill pipeline', () => {
  afterEach(() => setBridge({ invoke: () => Promise.reject(new Error('no bridge')) }))

  it('embeds all pending chunks, then skips unchanged ones on re-run (hash-skip)', async () => {
    const database = freshDatabase()
    const counters = installComboBridge(database)

    const ingest = await ingestDocument({ title: 'Roadmap', bodyText: threeChunkBody() })
    expect(ingest.chunkCount).toBe(3)
    expect(await countPending()).toBe(3)

    const first = await backfillEmbeddings()
    expect(first.status).toBe('completed')
    expect(first.embedded).toBe(3)
    expect(await countPending()).toBe(0)

    counters.embedded = 0
    const second = await backfillEmbeddings()
    expect(second.embedded).toBe(0) // nothing changed → nothing re-embedded
    expect(counters.embedded).toBe(0)
  })

  it('re-embeds a chunk whose text changed', async () => {
    const database = freshDatabase()
    installComboBridge(database)
    await ingestDocument({ title: 'Note', bodyText: threeChunkBody() })
    await backfillEmbeddings()
    expect(await countPending()).toBe(0)

    // Mutate one chunk's text directly: its content hash no longer matches.
    database.prepare("UPDATE content_chunks SET text = 'totally different text' WHERE chunk_index = 0").run()
    expect(await countPending()).toBe(1)

    const result = await backfillEmbeddings()
    expect(result.embedded).toBe(1)
    expect(await countPending()).toBe(0)
  })

  it('prunes embeddings whose source chunk no longer exists', async () => {
    const database = freshDatabase()
    installComboBridge(database)
    database
      .prepare("INSERT INTO chunk_embeddings (chunk_id, content_hash, model_id) VALUES ('ghost', 'h', 'all-MiniLM-L6-v2')")
      .run()
    const pruned = await pruneOrphanEmbeddings()
    expect(pruned).toBe(1)
    const remaining = database.prepare('SELECT count(*) AS n FROM chunk_embeddings').get()
    expect(remaining.n).toBe(0)
  })
})

describe('getEmbeddingsStatus', () => {
  afterEach(() => setBridge({ invoke: () => Promise.reject(new Error('no bridge')) }))

  it('reports disabled by default with honest counts', async () => {
    const database = freshDatabase()
    installComboBridge(database)
    await ingestDocument({ title: 'Doc', bodyText: threeChunkBody() })

    const status = await getEmbeddingsStatus()
    expect(status.enabled).toBe(false)
    expect(status.totalChunks).toBe(3)
    expect(status.indexed).toBe(0)
    expect(status.pending).toBe(3)
    expect(status.ready).toBe(false)
  })

  it('reports ready once enabled, indexed, and nothing pending', async () => {
    const database = freshDatabase()
    installComboBridge(database)
    await ingestDocument({ title: 'Doc', bodyText: threeChunkBody() })
    await setEmbeddingsEnabled(true)
    await backfillEmbeddings()

    const status = await getEmbeddingsStatus()
    expect(status.enabled).toBe(true)
    expect(status.indexed).toBe(3)
    expect(status.pending).toBe(0)
    expect(status.ready).toBe(true)
  })
})
