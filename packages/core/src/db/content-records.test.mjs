import { beforeEach, describe, expect, it } from 'vitest'
import {
  createDocument,
  createInteraction,
  getDocument,
  getInteraction,
  updateDocument,
  updateInteraction,
} from '@local-brain/core'
import { freshDatabase, installSqliteBridge } from './sqlite-harness.mjs'

describe.each([
  ['document', createDocument, getDocument, updateDocument],
  ['interaction', createInteraction, getInteraction, updateInteraction],
])('%s content writes (real SQLite)', (recordType, create, get, update) => {
  let database

  beforeEach(() => {
    database = freshDatabase()
    installSqliteBridge(database)
  })

  function chunks(id) {
    return database.prepare(
      'SELECT * FROM content_chunks WHERE record_type = ? AND record_id = ?',
    ).all(recordType, id)
  }

  it('preserves existing chunks when clearing a title or editing metadata', async () => {
    const id = await create({ title: 'Title', bodyText: 'The body remains searchable.' })
    const originalChunks = chunks(id)

    await update(id, { title: null, summary: '  Updated summary  ' })

    expect(await get(id)).toMatchObject({
      title: null,
      bodyText: 'The body remains searchable.',
      summary: 'Updated summary',
    })
    expect(chunks(id)).toEqual(originalChunks)
  })

  it('rolls back the body update when rebuilding chunks fails', async () => {
    const id = await create({ title: 'Title', bodyText: 'Original body.' })
    const originalChunks = chunks(id)
    database.exec(`
      CREATE TRIGGER reject_chunk_update BEFORE UPDATE ON content_chunks
      BEGIN SELECT RAISE(ABORT, 'chunk update rejected'); END;
    `)

    await expect(update(id, { bodyText: 'Replacement body.' })).rejects.toThrow(
      'chunk update rejected',
    )

    expect((await get(id)).bodyText).toBe('Original body.')
    expect(chunks(id)).toEqual(originalChunks)
  })

  it('does not create orphan chunks when the record does not exist', async () => {
    await expect(update('missing', { bodyText: 'Replacement body.' })).resolves.toBe(0)
    expect(chunks('missing')).toEqual([])
  })
})
