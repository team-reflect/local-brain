// Real-SQLite coverage for derived chunk navigation and parent visibility.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  batch,
  createPerson,
  db,
  execute,
  newId,
  searchRecordCandidates,
} from '@local-brain/core'
import { freshDatabase, installSqliteBridge } from './sqlite-harness.mjs'

describe('derived chunk navigation (real SQLite)', () => {
  beforeEach(() => {
    installSqliteBridge(freshDatabase())
  })

  it('routes a subject-anchored AI note to its person and hides it when archived', async () => {
    const personId = await createPerson({ fullName: 'Navigable Person' })
    const noteId = await insertAiNote({
      subjectType: 'person',
      subjectId: personId,
      text: 'The heliotrope research note belongs to this person.',
    })

    const visible = await searchRecordCandidates('heliotrope', { mode: 'lexical' })
    expect(visible.candidates).toEqual([
      expect.objectContaining({
        recordRef: `ai_note:${noteId}`,
        navigationRecordType: 'person',
        navigationRecordId: personId,
      }),
    ])

    await execute(
      db
        .updateTable('people')
        .set({ archivedAt: '2026-07-12T00:00:00.000Z' })
        .where('id', '=', personId),
    )
    const archived = await searchRecordCandidates('heliotrope', { mode: 'lexical' })
    expect(archived.candidates).toEqual([])
  })

  it('hides a note whose supported subject is missing', async () => {
    await insertAiNote({
      subjectType: 'person',
      subjectId: 'missing-person',
      text: 'The hidden chrysoberyl note has no live parent.',
    })

    const result = await searchRecordCandidates('chrysoberyl', { mode: 'lexical' })
    expect(result.candidates).toEqual([])
  })

  it('keeps non-record subject notes searchable without inventing navigation', async () => {
    const noteId = await insertAiNote({
      subjectType: 'daily_brief',
      subjectId: '2026-07-12',
      text: 'The daily brief mentions rhodochrosite follow-up.',
    })

    const result = await searchRecordCandidates('rhodochrosite', { mode: 'lexical' })
    expect(result.candidates).toEqual([
      expect.objectContaining({
        recordRef: `ai_note:${noteId}`,
        navigationRecordType: null,
        navigationRecordId: null,
      }),
    ])
  })
})

async function insertAiNote({ subjectType, subjectId, text }) {
  const noteId = newId()
  await batch([
    db.insertInto('aiNotes').values({
      id: noteId,
      subjectType,
      subjectId,
      title: 'Derived note',
      content: text,
    }),
    db.insertInto('contentChunks').values({
      id: newId(),
      recordType: 'ai_note',
      recordId: noteId,
      chunkIndex: 0,
      text,
    }),
  ])
  return noteId
}
