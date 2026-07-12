// Golden record-level Chat retrieval tests against the real launch SQLite
// schema and FTS triggers. These cover discovery gaps that chunk-only search
// cannot see, plus projection freshness and record diversity.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  createDocument,
  createInteraction,
  createMemory,
  createOrganization,
  createPerson,
  createProject,
  createTask,
  db,
  newId,
  searchRecordCandidates,
  updateDocument,
  updateInteraction,
  updateMemory,
} from '@local-brain/core'
import { freshDatabase, installSqliteBridge } from './sqlite-harness.mjs'

describe('record-level Chat candidates (real SQLite)', () => {
  beforeEach(() => {
    installSqliteBridge(freshDatabase())
  })

  it('finds title/name/summary/typed records that have no matching chunk', async () => {
    const documentId = await createDocument({ title: 'Quasar launch dossier' })
    const interactionId = await createInteraction({
      kind: 'meeting',
      title: 'Weekly kickoff',
      summary: 'Approved the Babylonstoren rollout for Q3',
    })
    const personId = await createPerson({ fullName: 'Marisol Vega' })
    const typedPersonId = await createPerson({ fullName: 'Sam Lee', primaryEmail: 'sam@coriander.example' })
    const notesPersonId = await createPerson({ fullName: 'Notes Person', notes: 'Keeps the topaz checklist nearby.' })
    const organizationId = await createOrganization({ name: 'Northwind', domain: 'saffron.example' })
    const projectId = await createProject({ name: 'Helios migration' })
    const taskId = await createTask({ title: 'Reconcile zephyr invoices' })

    await expectRef('quasar launch dossier', `document:${documentId}`)
    await expectRef('babylonstoren', `interaction:${interactionId}`)
    await expectRef('marisol vega', `person:${personId}`)
    await expectRef('coriander.example', `person:${typedPersonId}`, 'typed_field')
    await expectRef('topaz checklist', `person:${notesPersonId}`, 'summary')
    await expectRef('saffron.example', `organization:${organizationId}`, 'typed_field')
    await expectRef('helios migration', `project:${projectId}`)
    await expectRef('zephyr invoices', `task:${taskId}`)
  })

  it('makes ordinary Chat-equivalent interaction and memory writes immediately searchable', async () => {
    const interactionId = await createInteraction({
      kind: 'note',
      title: 'Supplier update',
      bodyText: 'The cobalt shipment is delayed until Thursday.',
    })
    const memory = await createMemory({ claim: 'Alex prefers silent mornings for deep work.' })

    await expectRef('cobalt shipment', `interaction:${interactionId}`)
    await expectRef('silent mornings', `memory:${memory.id}`)
  })

  it('refreshes interaction and memory projections when their source text is corrected', async () => {
    const interactionId = await createInteraction({
      kind: 'note',
      title: 'Mutable interaction',
      bodyText: 'The obsolete papaya detail is wrong.',
    })
    const memory = await createMemory({ claim: 'The obsolete kumquat preference is wrong.' })

    await updateInteraction(interactionId, { bodyText: 'The current guava detail is correct.' })
    await updateMemory(memory.id, { claim: 'The current persimmon preference is correct.' })

    const staleInteraction = await searchRecordCandidates('obsolete papaya', { mode: 'lexical' })
    const staleMemory = await searchRecordCandidates('obsolete kumquat', { mode: 'lexical' })
    expect(staleInteraction.candidates.map((candidate) => candidate.recordRef)).not.toContain(
      `interaction:${interactionId}`,
    )
    expect(staleMemory.candidates.map((candidate) => candidate.recordRef)).not.toContain(
      `memory:${memory.id}`,
    )
    await expectRef('current guava', `interaction:${interactionId}`)
    await expectRef('current persimmon', `memory:${memory.id}`)
  })


  it('refreshes chunk text/hash, makes old vectors inert, and preserves stable evidence on edit', async () => {
    const documentId = await createDocument({
      title: 'Mutable source',
      bodyText: 'The obsolete narwhal launch code is orange.',
    })
    const before = await db
      .selectFrom('contentChunks')
      .select(['id', 'contentHash'])
      .where('recordType', '=', 'document')
      .where('recordId', '=', documentId)
      .executeTakeFirstOrThrow()
    await db
      .insertInto('chunkEmbeddings')
      .values({ chunkId: before.id, contentHash: before.contentHash ?? 'legacy', modelId: 'test-model' })
      .execute()
    await db.updateTable('contentChunks').set({ tokenCount: 999 }).where('id', '=', before.id).execute()
    const evidenceId = newId()
    await db
      .insertInto('evidenceRefs')
      .values({
        id: evidenceId,
        subjectType: 'task',
        subjectId: 'test-subject',
        chunkId: before.id,
        quoteStart: 4,
        quoteEnd: 20,
      })
      .execute()

    await updateDocument(documentId, { bodyText: 'The current kestrel launch code is violet.' })

    const after = await db
      .selectFrom('contentChunks')
      .select(['id', 'text', 'contentHash', 'tokenCount'])
      .where('recordType', '=', 'document')
      .where('recordId', '=', documentId)
      .executeTakeFirstOrThrow()
    expect(after.id).toBe(before.id)
    expect(after.text).toContain('current kestrel')
    expect(after.contentHash).not.toBe(before.contentHash)
    expect(after.tokenCount).toBeNull()
    expect(await db.selectFrom('chunkEmbeddings').select(['chunkId', 'contentHash']).execute()).toEqual([
      { chunkId: before.id, contentHash: before.contentHash },
    ])
    expect(await db.selectFrom('evidenceRefs').select(['quoteStart', 'quoteEnd']).where('id', '=', evidenceId).executeTakeFirst()).toEqual({
      quoteStart: null,
      quoteEnd: null,
    })

    const stale = await searchRecordCandidates('obsolete narwhal', { mode: 'lexical' })
    expect(stale.candidates.map((candidate) => candidate.recordRef)).not.toContain(`document:${documentId}`)
    await expectRef('current kestrel', `document:${documentId}`)
  })

  it('leaves removed-tail vectors for async pruning and cascades evidence when content becomes shorter', async () => {
    const documentId = await createDocument({
      title: 'Shrinking source',
      bodyText: `first section ${'x'.repeat(1_100)}`,
    })
    const chunks = await db
      .selectFrom('contentChunks')
      .select(['id', 'contentHash', 'chunkIndex'])
      .where('recordType', '=', 'document')
      .where('recordId', '=', documentId)
      .orderBy('chunkIndex')
      .execute()
    expect(chunks.length).toBeGreaterThan(1)
    const tail = chunks.at(-1)
    await db
      .insertInto('chunkEmbeddings')
      .values({ chunkId: tail.id, contentHash: tail.contentHash ?? 'legacy', modelId: 'test-model' })
      .execute()
    const evidenceId = newId()
    await db
      .insertInto('evidenceRefs')
      .values({ id: evidenceId, subjectType: 'task', subjectId: 'test-subject', chunkId: tail.id })
      .execute()

    await updateDocument(documentId, { bodyText: 'Short replacement.' })

    expect(
      await db
        .selectFrom('contentChunks')
        .select('id')
        .where('recordType', '=', 'document')
        .where('recordId', '=', documentId)
        .execute(),
    ).toHaveLength(1)
    expect(await db.selectFrom('chunkEmbeddings').select('chunkId').execute()).toEqual([
      { chunkId: tail.id },
    ])
    expect(await db.selectFrom('evidenceRefs').select('id').where('id', '=', evidenceId).execute()).toEqual([])
  })

  it('collapses chunks before ranking so one long transcript cannot occupy every slot', async () => {
    const paragraph = (index) => `orchid transcript section ${index} ${'x'.repeat(850)}`
    await createDocument({
      title: 'Long transcript',
      bodyText: Array.from({ length: 24 }, (_, index) => paragraph(index)).join('\n\n'),
    })
    for (let index = 0; index < 5; index += 1) {
      await createDocument({ title: `Short orchid note ${index}`, bodyText: `orchid evidence ${index}` })
    }

    const result = await searchRecordCandidates('orchid', {
      mode: 'lexical',
      recordTypes: ['document'],
      limit: 6,
    })

    expect(result.candidates).toHaveLength(6)
    expect(new Set(result.candidates.map((candidate) => candidate.recordRef))).toHaveLength(6)
    expect(result.candidates.every((candidate) => candidate.evidence.length <= 2)).toBe(true)
  })

  it('falls back to lexical candidates when semantic search is unavailable', async () => {
    const id = await createDocument({ title: 'Fallback', bodyText: 'The albatross protocol is ready.' })
    const result = await searchRecordCandidates('albatross protocol', { mode: 'semantic' })

    expect(result.semanticAvailable).toBe(false)
    expect(result.candidates.map((candidate) => candidate.recordRef)).toContain(`document:${id}`)
  })

  it('excludes orphaned derived chunks whose owner record does not exist', async () => {
    await db
      .insertInto('contentChunks')
      .values({
        id: newId(),
        recordType: 'document',
        recordId: 'missing-document',
        chunkIndex: 0,
        text: 'orphaned platypus evidence',
      })
      .execute()

    const result = await searchRecordCandidates('orphaned platypus', { mode: 'lexical' })
    expect(result.candidates).toEqual([])
  })

  it('filters through relation-only interaction participants', async () => {
    const personId = await createPerson({ fullName: 'Inez Calder' })
    const interactionId = await createInteraction(
      {
        kind: 'email',
        title: 'Budget follow-up',
        bodyText: 'The budget allocation is ready for review.',
        occurredAt: '2026-07-01T09:00:00Z',
      },
      [{ personId, role: 'participant' }],
    )
    await createInteraction({
      kind: 'email',
      title: 'Unrelated budget',
      bodyText: 'Another budget allocation.',
      occurredAt: '2026-07-02T09:00:00Z',
    })

    const result = await searchRecordCandidates('budget', {
      mode: 'lexical',
      recordTypes: ['interaction'],
      kinds: ['email'],
      relatedTo: [{ recordType: 'person', recordId: personId }],
    })

    expect(result.candidates.map((candidate) => candidate.recordRef)).toEqual([
      `interaction:${interactionId}`,
    ])
    expect(result.candidates[0]?.matchReasons).toContain('related')
  })

  it('finds a participant-related transcript through its parent interaction', async () => {
    const personId = await createPerson({ fullName: 'Transcript participant' })
    const interactionId = await createInteraction(
      { kind: 'meeting', title: 'Recorded meeting' },
      [{ personId, role: 'participant' }],
    )
    const transcriptId = newId()
    await db
      .insertInto('interactionTranscripts')
      .values({ id: transcriptId, interactionId, rawText: 'The lapis roadmap ships next quarter.' })
      .execute()
    await db
      .insertInto('contentChunks')
      .values({
        id: newId(),
        recordType: 'interaction_transcript',
        recordId: transcriptId,
        chunkIndex: 0,
        text: 'The lapis roadmap ships next quarter.',
      })
      .execute()

    const result = await searchRecordCandidates('lapis roadmap', {
      mode: 'lexical',
      recordTypes: ['interaction_transcript'],
      relatedTo: [{ recordType: 'person', recordId: personId }],
    })

    expect(result.candidates.map((candidate) => candidate.recordRef)).toEqual([
      `interaction_transcript:${transcriptId}`,
    ])
    expect(result.candidates[0]).toMatchObject({
      navigationRecordType: 'interaction',
      navigationRecordId: interactionId,
    })
  })

  it('browses title-only records with kind/date filters in strict recency order', async () => {
    const older = await createInteraction({
      kind: 'email',
      title: 'Older title-only email',
      occurredAt: '2026-06-10T09:00:00Z',
    })
    const newer = await createInteraction({
      kind: 'email',
      title: 'Newer title-only email',
      occurredAt: '2026-06-20T09:00:00Z',
    })
    await createInteraction({
      kind: 'meeting',
      title: 'Filtered meeting',
      occurredAt: '2026-06-25T09:00:00Z',
    })

    const result = await searchRecordCandidates('', {
      recordTypes: ['interaction'],
      kinds: ['email'],
      after: '2026-06-01',
      before: '2026-06-30',
      sort: 'recency',
    })

    expect(result.candidates.map((candidate) => candidate.recordRef)).toEqual([
      `interaction:${newer}`,
      `interaction:${older}`,
    ])
  })

  it('ranks field quality and term coverage before applying the per-source candidate limit', async () => {
    const completeMatch = await createProject({
      name: 'Amber coordinator',
      summary: 'Owns the protocol for the launch.',
    })
    await db
      .updateTable('projects')
      .set({ updatedAt: '2020-01-01T09:00:00Z' })
      .where('id', '=', completeMatch)
      .execute()

    // A requested limit of two gives the direct leg a candidate limit of eight.
    // More than eight newer one-term title hits used to crowd out the older row
    // before JavaScript had a chance to count its two matching terms.
    for (let index = 0; index < 12; index += 1) {
      const id = await createProject({ name: `Amber recent project ${index}` })
      await db
        .updateTable('projects')
        .set({ updatedAt: `2026-06-${String(index + 1).padStart(2, '0')}T09:00:00Z` })
        .where('id', '=', id)
        .execute()
    }

    const result = await searchRecordCandidates('amber protocol', {
      mode: 'lexical',
      limit: 2,
      recordTypes: ['project'],
    })

    expect(result.candidates[0]?.recordRef).toBe(`project:${completeMatch}`)
  })

  it('dates derived profiles/transcripts and hides profiles with archived parents', async () => {
    const organizationId = await createOrganization({ name: 'Dated organization' })
    await db
      .insertInto('organizationProfiles')
      .values({
        id: 'profile-dated',
        organizationId,
        oneLineDescription: 'Dated profile',
        researchedAt: '2026-06-10T09:00:00Z',
      })
      .execute()
    await db
      .insertInto('contentChunks')
      .values({
        id: 'profile-dated-chunk',
        recordType: 'organization_profile',
        recordId: 'profile-dated',
        chunkIndex: 0,
        text: 'Profile evidence',
      })
      .execute()

    const interactionId = await createInteraction({ kind: 'meeting', title: 'Undated meeting' })
    await db
      .insertInto('interactionTranscripts')
      .values({
        id: 'transcript-dated',
        interactionId,
        rawText: 'Transcript evidence',
        transcribedAt: '2026-06-20T09:00:00Z',
      })
      .execute()
    await db
      .insertInto('contentChunks')
      .values({
        id: 'transcript-dated-chunk',
        recordType: 'interaction_transcript',
        recordId: 'transcript-dated',
        chunkIndex: 0,
        text: 'Transcript evidence',
      })
      .execute()

    const result = await searchRecordCandidates('', {
      recordTypes: ['organization_profile', 'interaction_transcript'],
      after: '2026-06-01',
      before: '2026-06-30',
      sort: 'recency',
    })
    expect(result.candidates.map((candidate) => candidate.recordRef)).toEqual([
      'interaction_transcript:transcript-dated',
      'organization_profile:profile-dated',
    ])
    expect(result.candidates).toEqual([
      expect.objectContaining({
        navigationRecordType: 'interaction',
        navigationRecordId: interactionId,
      }),
      expect.objectContaining({
        navigationRecordType: 'organization',
        navigationRecordId: organizationId,
      }),
    ])

    await db
      .updateTable('organizations')
      .set({ archivedAt: '2026-07-01T00:00:00Z' })
      .where('id', '=', organizationId)
      .execute()
    const archived = await searchRecordCandidates('', {
      recordTypes: ['organization_profile'],
      after: '2026-06-01',
      sort: 'recency',
    })
    expect(archived.candidates).toEqual([])
  })

  it('applies relation filters before candidate limits', async () => {
    const personId = await createPerson({ fullName: 'Older participant' })
    const relatedId = await createInteraction(
      {
        kind: 'meeting',
        title: 'Older selective budget',
        bodyText: 'Budget evidence for the related participant.',
        occurredAt: '2020-01-01T09:00:00Z',
      },
      [{ personId, role: 'participant' }],
    )
    // `limit: 2` over-fetches eight candidates. More than eight newer
    // unrelated matches prove a post-LIMIT relation filter would lose the row.
    for (let index = 0; index < 20; index += 1) {
      await createInteraction({
        kind: 'meeting',
        title: `Newer budget ${index}`,
        bodyText: `Budget evidence ${index}`,
        occurredAt: `2026-06-${String(index + 1).padStart(2, '0')}T09:00:00Z`,
      })
    }

    const result = await searchRecordCandidates('budget', {
      mode: 'lexical',
      limit: 2,
      recordTypes: ['interaction'],
      relatedTo: [{ recordType: 'person', recordId: personId }],
    })

    expect(result.candidates.map((candidate) => candidate.recordRef)).toEqual([
      `interaction:${relatedId}`,
    ])
  })
})

async function expectRef(query, expectedRef, expectedReason) {
  const result = await searchRecordCandidates(query, { mode: 'lexical' })
  const candidate = result.candidates.find((item) => item.recordRef === expectedRef)
  expect(candidate).toBeDefined()
  if (expectedReason) expect(candidate.matchReasons).toContain(expectedReason)
}
