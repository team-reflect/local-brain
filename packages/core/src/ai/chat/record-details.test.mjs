import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@local-brain/core'
import { freshDatabase, installSqliteBridge } from '../../db/sqlite-harness.mjs'
import { getChatRecords } from './record-details.ts'

const NOW = '2026-06-19T12:00:00.000Z'

async function insertChunk(recordType, recordId, chunkIndex, text) {
  await db
    .insertInto('contentChunks')
    .values({
      id: `${recordType}-${recordId}-${chunkIndex}`,
      recordType,
      recordId,
      chunkIndex,
      text,
    })
    .execute()
}

async function seedAllRecordKinds() {
  await db.insertInto('people').values({ id: 'person-1', fullName: 'Maya Chen' }).execute()
  await db.insertInto('organizations').values({ id: 'org-1', name: 'Northwind' }).execute()
  await db
    .insertInto('organizationProfiles')
    .values({
      id: 'profile-1',
      organizationId: 'org-1',
      oneLineDescription: 'Northwind profile',
    })
    .execute()
  await db.insertInto('projects').values({ id: 'project-1', name: 'Atlas' }).execute()
  await db.insertInto('tasks').values({ id: 'task-1', title: 'Send budget' }).execute()
  await db
    .insertInto('documents')
    .values({
      id: 'doc-1',
      title: 'Budget memo',
      bodyText: 'This body should be available from chunks, not metadata.',
      updatedAt: NOW,
    })
    .execute()
  await db
    .insertInto('interactions')
    .values({ id: 'interaction-1', kind: 'meeting', title: 'Budget sync', occurredAt: NOW })
    .execute()
  await db
    .insertInto('interactionTranscripts')
    .values({
      id: 'transcript-1',
      interactionId: 'interaction-1',
      rawText: 'Transcript raw text should be available from chunks, not metadata.',
    })
    .execute()
  await db
    .insertInto('aiNotes')
    .values({ id: 'note-1', documentId: 'doc-1', title: 'Budget summary', content: 'AI note content.' })
    .execute()
  await db
    .insertInto('extractedFacts')
    .values({
      id: 'fact-1',
      subjectType: 'person',
      subjectId: 'person-1',
      key: 'preference',
      valueText: 'Maya prefers concise updates.',
    })
    .execute()
  await db.insertInto('memories').values({ id: 'memory-1', claim: 'Maya prefers concise updates.' }).execute()
  await db
    .insertInto('assets')
    .values({
      id: 'asset-1',
      byteSize: 12,
      contentHash: 'asset-hash',
      storagePath: 'assets/asset-1',
      originalFilename: 'budget.pdf',
    })
    .execute()

  const records = [
    ['person', 'person-1'],
    ['organization', 'org-1'],
    ['organization_profile', 'profile-1'],
    ['project', 'project-1'],
    ['task', 'task-1'],
    ['document', 'doc-1'],
    ['interaction', 'interaction-1'],
    ['interaction_transcript', 'transcript-1'],
    ['ai_note', 'note-1'],
    ['extracted_fact', 'fact-1'],
    ['memory', 'memory-1'],
    ['asset', 'asset-1'],
  ]
  for (const [recordType, recordId] of records) {
    await insertChunk(recordType, recordId, 0, `${recordType} chunk text`)
  }
  return records.map(([recordType, recordId]) => ({ recordType, recordId }))
}

describe('getChatRecords', () => {
  beforeEach(() => installSqliteBridge(freshDatabase()))

  it('returns every searchable record kind with bounded chunks', async () => {
    const requests = await seedAllRecordKinds()

    const details = await getChatRecords(requests, { maxCharsPerRecord: 50 })

    expect(details).toHaveLength(requests.length)
    expect(details.every((detail) => detail.found)).toBe(true)
    expect(details.every((detail) => detail.chunks.length === 1)).toBe(true)
    const document = details.find((detail) => detail.recordType === 'document')
    expect(JSON.stringify(document?.metadata)).not.toContain('This body should be available')
    const transcript = details.find((detail) => detail.recordType === 'interaction_transcript')
    expect(JSON.stringify(transcript?.metadata)).not.toContain('Transcript raw text')
  })

  it('returns missing records as found false', async () => {
    const [detail] = await getChatRecords([{ recordType: 'interaction', recordId: 'missing' }])

    expect(detail).toMatchObject({
      recordType: 'interaction',
      recordId: 'missing',
      found: false,
      title: null,
      chunks: [],
      truncated: false,
    })
  })

  it('focuses chunkIds with immediate neighbours and marks partial context truncated', async () => {
    await db
      .insertInto('interactions')
      .values({ id: 'interaction-1', kind: 'meeting', title: 'Budget sync', occurredAt: NOW })
      .execute()
    await insertChunk('interaction', 'interaction-1', 0, 'zero')
    await insertChunk('interaction', 'interaction-1', 1, 'one')
    await insertChunk('interaction', 'interaction-1', 2, 'two')
    await insertChunk('interaction', 'interaction-1', 3, 'three')

    const [detail] = await getChatRecords([
      {
        recordType: 'interaction',
        recordId: 'interaction-1',
        chunkIds: ['interaction-interaction-1-2'],
      },
    ])

    expect(detail?.chunks.map((chunk) => chunk.chunkIndex)).toEqual([1, 2, 3])
    expect(detail?.truncated).toBe(true)
  })

  it('clips chunk text to the per-record character budget', async () => {
    await db
      .insertInto('interactions')
      .values({ id: 'interaction-1', kind: 'meeting', title: 'Budget sync', occurredAt: NOW })
      .execute()
    await insertChunk('interaction', 'interaction-1', 0, 'abcdefghijklmnopqrstuvwxyz')

    const [detail] = await getChatRecords(
      [{ recordType: 'interaction', recordId: 'interaction-1' }],
      { maxCharsPerRecord: 5 },
    )

    expect(detail?.chunks).toEqual([{ chunkId: 'interaction-interaction-1-0', chunkIndex: 0, text: 'abcde' }])
    expect(detail?.truncated).toBe(true)
  })
})
