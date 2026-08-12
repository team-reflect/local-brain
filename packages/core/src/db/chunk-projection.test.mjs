import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDocument, updateDocument } from '@local-brain/core'
import { freshDatabase, installSqliteBridge } from './sqlite-harness.mjs'

function hash(text) {
  return createHash('sha256').update(text).digest('hex')
}

describe('content chunk projection', () => {
  let database

  beforeEach(() => {
    database = freshDatabase()
    installSqliteBridge(database)
  })

  it('repairs legacy exact duplicates without losing or mispointing evidence refs', async () => {
    const documentId = await createDocument({ title: 'Quoted email thread' })
    const first = 'a'.repeat(1_000)
    const second = 'b'.repeat(1_000)
    const third = 'c'.repeat(1_000)
    const sourceBody = `${first}\n\n${second}\n\n${first}\n\n${third}`

    database.prepare('UPDATE documents SET body_text = ? WHERE id = ?').run(sourceBody, documentId)
    const insertChunk = database.prepare(`
      INSERT INTO content_chunks
        (id, record_type, record_id, chunk_index, text, content_hash)
      VALUES (?, 'document', ?, ?, ?, ?)
    `)
    insertChunk.run('chunk-first', documentId, 0, first, hash(first))
    insertChunk.run('chunk-second', documentId, 1, second, hash(second))
    insertChunk.run('chunk-first-copy', documentId, 2, first, hash(first))
    insertChunk.run('chunk-third', documentId, 3, third, hash(third))
    database.prepare(`
      INSERT INTO evidence_refs
        (id, subject_type, subject_id, chunk_id, quote_start, quote_end)
      VALUES
        ('e-canonical', 'memory', 'memory-1', 'chunk-first', 10, 20),
        ('e-copy', 'memory', 'memory-1', 'chunk-first-copy', 10, 20),
        ('e-shifted', 'task', 'task-1', 'chunk-third', 30, 40)
    `).run()

    await updateDocument(documentId, { bodyText: sourceBody })

    expect(database.prepare(`
      SELECT id, chunk_index AS chunkIndex, text
      FROM content_chunks
      WHERE record_type = 'document' AND record_id = ?
      ORDER BY chunk_index
    `).all(documentId)).toEqual([
      { id: 'chunk-first', chunkIndex: 0, text: first },
      { id: 'chunk-second', chunkIndex: 1, text: second },
      { id: 'chunk-third', chunkIndex: 2, text: third },
    ])
    expect(database.prepare(`
      SELECT id, chunk_id AS chunkId, quote_start AS quoteStart, quote_end AS quoteEnd
      FROM evidence_refs
      ORDER BY id
    `).all()).toEqual([
      { id: 'e-canonical', chunkId: 'chunk-first', quoteStart: 10, quoteEnd: 20 },
      { id: 'e-copy', chunkId: 'chunk-first', quoteStart: 10, quoteEnd: 20 },
      { id: 'e-shifted', chunkId: 'chunk-third', quoteStart: 30, quoteEnd: 40 },
    ])

    // The same projection is idempotent: no ids or citations churn on rerun.
    await updateDocument(documentId, { bodyText: sourceBody })
    expect(database.prepare(`
      SELECT id
      FROM content_chunks
      WHERE record_type = 'document' AND record_id = ?
      ORDER BY chunk_index
    `).all(documentId).map((row) => row.id)).toEqual([
      'chunk-first',
      'chunk-second',
      'chunk-third',
    ])
    expect(database.prepare('SELECT COUNT(*) AS count FROM evidence_refs').get().count).toBe(3)
  })

  it('refreshes a stale chunk hash without clearing valid quote offsets', async () => {
    const bodyText = 'A stable quoted passage with enough text for evidence offsets.'
    const documentId = await createDocument({ title: 'Legacy hash', bodyText })
    const chunk = database.prepare(`
      SELECT id
      FROM content_chunks
      WHERE record_type = 'document' AND record_id = ? AND chunk_index = 0
    `).get(documentId)

    database.prepare('UPDATE content_chunks SET content_hash = NULL WHERE id = ?').run(chunk.id)
    database.prepare(`
      INSERT INTO evidence_refs
        (id, subject_type, subject_id, chunk_id, quote_start, quote_end)
      VALUES ('e-stale-hash', 'memory', 'memory-1', ?, 9, 23)
    `).run(chunk.id)

    await updateDocument(documentId, { bodyText })

    expect(database.prepare(`
      SELECT text, content_hash AS contentHash
      FROM content_chunks
      WHERE id = ?
    `).get(chunk.id)).toEqual({ text: bodyText, contentHash: hash(bodyText) })
    expect(database.prepare(`
      SELECT chunk_id AS chunkId, quote_start AS quoteStart, quote_end AS quoteEnd
      FROM evidence_refs
      WHERE id = 'e-stale-hash'
    `).get()).toEqual({ chunkId: chunk.id, quoteStart: 9, quoteEnd: 23 })
  })
})
