// Real-SQLite coverage for UI/Chat corrections to CLI-enriched entity chunks.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  createOrganization,
  createPerson,
  db,
  execute,
  newId,
  searchRecordCandidates,
  updateOrganization,
  updatePerson,
} from '@local-brain/core'
import { freshDatabase, installSqliteBridge } from './sqlite-harness.mjs'

describe('entity content projection (real SQLite)', () => {
  beforeEach(() => {
    installSqliteBridge(freshDatabase())
  })

  it('refreshes canonical person and organization chunks after corrections', async () => {
    const personId = await createPerson({
      fullName: 'Mutable Person',
      summary: 'The obsolete labradorite specialty is wrong.',
    })
    const organizationId = await createOrganization({
      name: 'Mutable Organization',
      summary: 'The obsolete moonstone market is wrong.',
    })
    const personChunkId = newId()
    const organizationChunkId = newId()
    await execute(
      db.insertInto('contentChunks').values({
        id: personChunkId,
        recordType: 'person',
        recordId: personId,
        chunkIndex: 0,
        text: 'Mutable Person The obsolete labradorite specialty is wrong.',
        contentHash: 'old-person-hash',
      }),
    )
    await execute(
      db.insertInto('contentChunks').values({
        id: organizationChunkId,
        recordType: 'organization',
        recordId: organizationId,
        chunkIndex: 0,
        text: 'Mutable Organization The obsolete moonstone market is wrong.',
        contentHash: 'old-organization-hash',
      }),
    )

    await updatePerson(personId, { summary: 'The current aventurine specialty is correct.' })
    await updateOrganization(organizationId, {
      summary: 'The current sunstone market is correct.',
    })

    const chunks = await db
      .selectFrom('contentChunks')
      .select(['id', 'recordType', 'text', 'contentHash'])
      .where('id', 'in', [personChunkId, organizationChunkId])
      .orderBy('recordType')
      .execute()
    expect(chunks).toHaveLength(2)
    expect(chunks.find((chunk) => chunk.recordType === 'person')).toMatchObject({
      id: personChunkId,
      text: expect.stringContaining('aventurine'),
    })
    expect(chunks.find((chunk) => chunk.recordType === 'organization')).toMatchObject({
      id: organizationChunkId,
      text: expect.stringContaining('sunstone'),
    })
    expect(chunks.map((chunk) => chunk.text).join(' ')).not.toMatch(/labradorite|moonstone/)
    expect(chunks.map((chunk) => chunk.contentHash)).not.toContain('old-person-hash')
    expect(chunks.map((chunk) => chunk.contentHash)).not.toContain('old-organization-hash')

    await expectRefAbsent('labradorite', `person:${personId}`)
    await expectRefAbsent('moonstone', `organization:${organizationId}`)
    await expectRef('aventurine', `person:${personId}`)
    await expectRef('sunstone', `organization:${organizationId}`)
  })
})

async function expectRef(query, expectedRef) {
  const result = await searchRecordCandidates(query, { mode: 'lexical' })
  expect(result.candidates.map((candidate) => candidate.recordRef)).toContain(expectedRef)
}

async function expectRefAbsent(query, unexpectedRef) {
  const result = await searchRecordCandidates(query, { mode: 'lexical' })
  expect(result.candidates.map((candidate) => candidate.recordRef)).not.toContain(unexpectedRef)
}
