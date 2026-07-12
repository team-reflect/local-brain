// One-hop relation coverage for record-level Chat search against the real
// launch SQLite schema and FTS triggers.

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
} from '@local-brain/core'
import { freshDatabase, installSqliteBridge } from './sqlite-harness.mjs'

describe('record-level Chat relation candidates (real SQLite)', () => {
  beforeEach(() => {
    installSqliteBridge(freshDatabase())
  })

  it('resolves direct asset, AI-note, and extracted-fact anchors for every relation ref', async () => {
    const refs = [
      { recordType: 'person', recordId: await createPerson({ fullName: 'Anchor person' }) },
      { recordType: 'organization', recordId: await createOrganization({ name: 'Anchor organization' }) },
      { recordType: 'project', recordId: await createProject({ name: 'Anchor project' }) },
      { recordType: 'task', recordId: await createTask({ title: 'Anchor task' }) },
      { recordType: 'document', recordId: await createDocument({ title: 'Anchor document' }) },
      {
        recordType: 'interaction',
        recordId: await createInteraction({ kind: 'meeting', title: 'Anchor interaction' }),
      },
    ]
    const factSubjectId = await createPerson({ fullName: 'Different fact subject' })

    for (const ref of refs) {
      const suffix = ref.recordType.replaceAll('_', '')
      const assetMarker = `asset${suffix}marker`
      const assetId = newId()
      await db
        .insertInto('assets')
        .values({
          id: assetId,
          byteSize: 1,
          contentHash: `hash-${assetId}`,
          storagePath: `assets/${assetId}`,
        })
        .execute()
      await db
        .insertInto('assetLinks')
        .values({
          id: newId(),
          assetId,
          recordType: ref.recordType,
          recordId: ref.recordId,
        })
        .execute()
      await insertTestChunk('asset', assetId, assetMarker)
      await expectRelatedRef(assetMarker, `asset:${assetId}`, [ref])

      const noteMarker = `note${suffix}marker`
      const noteId = newId()
      await db
        .insertInto('aiNotes')
        .values({
          id: noteId,
          subjectType: ref.recordType,
          subjectId: ref.recordId,
          content: noteMarker,
        })
        .execute()
      await insertTestChunk('ai_note', noteId, noteMarker)
      await expectRelatedRef(noteMarker, `ai_note:${noteId}`, [ref])

      const subjectFactMarker = `subjectfact${suffix}marker`
      const subjectFactId = newId()
      await db
        .insertInto('extractedFacts')
        .values({
          id: subjectFactId,
          subjectType: ref.recordType,
          subjectId: ref.recordId,
          key: subjectFactMarker,
          valueText: subjectFactMarker,
        })
        .execute()
      await insertTestChunk('extracted_fact', subjectFactId, subjectFactMarker)
      await expectRelatedRef(subjectFactMarker, `extracted_fact:${subjectFactId}`, [ref])

      const sourceFactMarker = `sourcefact${suffix}marker`
      const sourceFactId = newId()
      await db
        .insertInto('extractedFacts')
        .values({
          id: sourceFactId,
          subjectType: 'person',
          subjectId: factSubjectId,
          sourceRecordType: ref.recordType,
          sourceRecordId: ref.recordId,
          key: sourceFactMarker,
          valueText: sourceFactMarker,
        })
        .execute()
      await insertTestChunk('extracted_fact', sourceFactId, sourceFactMarker)
      await expectRelatedRef(sourceFactMarker, `extracted_fact:${sourceFactId}`, [ref])
    }

    for (const ref of refs.filter(({ recordType }) => ['document', 'interaction'].includes(recordType))) {
      const marker = `directnote${ref.recordType}marker`
      const noteId = newId()
      await db
        .insertInto('aiNotes')
        .values({
          id: noteId,
          content: marker,
          ...(ref.recordType === 'document'
            ? { documentId: ref.recordId }
            : { interactionId: ref.recordId }),
        })
        .execute()
      await insertTestChunk('ai_note', noteId, marker)
      await expectRelatedRef(marker, `ai_note:${noteId}`, [ref])
    }
  })

  it('resolves task origins and sources in both directions, including interaction transcripts', async () => {
    const documentId = await createDocument({
      title: 'Citrine origin document',
      bodyText: 'Citrine document source material.',
    })
    const interactionId = await createInteraction({
      kind: 'meeting',
      title: 'Citrine origin meeting',
      bodyText: 'Citrine interaction source material.',
    })
    const personId = await createPerson({ fullName: 'Citrine source person' })
    const transcriptId = newId()
    await db
      .insertInto('interactionTranscripts')
      .values({ id: transcriptId, interactionId, rawText: 'Citrine origin transcript marker.' })
      .execute()
    await insertTestChunk('interaction_transcript', transcriptId, 'citrineorigintranscript')

    const taskId = await createTask({ title: 'Citrine anchored task' })
    await db
      .updateTable('tasks')
      .set({
        originDocumentId: documentId,
        originInteractionId: interactionId,
        sourceRecordType: 'person',
        sourceRecordId: personId,
      })
      .where('id', '=', taskId)
      .execute()

    await expectRelatedRef('citrine anchored task', `task:${taskId}`, [
      { recordType: 'document', recordId: documentId },
      { recordType: 'interaction', recordId: interactionId },
      { recordType: 'person', recordId: personId },
    ])
    await expectRelatedRef('citrine origin document', `document:${documentId}`, [
      { recordType: 'task', recordId: taskId },
    ])
    await expectRelatedRef('citrine origin meeting', `interaction:${interactionId}`, [
      { recordType: 'task', recordId: taskId },
    ])
    await expectRelatedRef('citrine source person', `person:${personId}`, [
      { recordType: 'task', recordId: taskId },
    ])
    await expectRelatedRef('citrineorigintranscript', `interaction_transcript:${transcriptId}`, [
      { recordType: 'task', recordId: taskId },
    ])

    const sourceInteractionId = await createInteraction({
      kind: 'call',
      title: 'Sapphire source interaction',
    })
    const sourceTranscriptId = newId()
    await db
      .insertInto('interactionTranscripts')
      .values({
        id: sourceTranscriptId,
        interactionId: sourceInteractionId,
        rawText: 'Sapphire source transcript marker.',
      })
      .execute()
    await insertTestChunk('interaction_transcript', sourceTranscriptId, 'sapphiresourcestranscript')
    const sourceTaskId = await createTask({ title: 'Sapphire source task' })
    await db
      .updateTable('tasks')
      .set({ sourceRecordType: 'interaction', sourceRecordId: sourceInteractionId })
      .where('id', '=', sourceTaskId)
      .execute()

    await expectRelatedRef(
      'sapphiresourcestranscript',
      `interaction_transcript:${sourceTranscriptId}`,
      [{ recordType: 'task', recordId: sourceTaskId }],
    )
  })

  it('resolves document-linked transcripts and evidence anchors in both directions', async () => {
    const documentId = await createDocument({
      title: 'Opal evidence document',
      bodyText: 'The opal archive contains the supporting proof.',
    })
    const documentChunk = await db
      .selectFrom('contentChunks')
      .select('id')
      .where('recordType', '=', 'document')
      .where('recordId', '=', documentId)
      .executeTakeFirstOrThrow()
    const taskId = await createTask({ title: 'Lantern evidence subject' })
    await db
      .insertInto('evidenceRefs')
      .values({ id: newId(), subjectType: 'task', subjectId: taskId, chunkId: documentChunk.id })
      .execute()

    await expectRelatedRef('lantern evidence subject', `task:${taskId}`, [
      { recordType: 'document', recordId: documentId },
    ])
    await expectRelatedRef('opal archive', `document:${documentId}`, [
      { recordType: 'task', recordId: taskId },
    ])

    const interactionId = await createInteraction({ kind: 'meeting', title: 'Linked transcript meeting' })
    const transcriptId = newId()
    await db
      .insertInto('interactionTranscripts')
      .values({ id: transcriptId, interactionId, rawText: 'Topaz linked transcript marker.' })
      .execute()
    const transcriptChunkId = await insertTestChunk(
      'interaction_transcript',
      transcriptId,
      'topazlinkedtranscript',
    )
    await db
      .insertInto('documentInteractions')
      .values({ id: newId(), documentId, interactionId })
      .execute()

    await expectRelatedRef('topazlinkedtranscript', `interaction_transcript:${transcriptId}`, [
      { recordType: 'document', recordId: documentId },
    ])

    const linkedInteractionNoteId = newId()
    await db
      .insertInto('aiNotes')
      .values({
        id: linkedInteractionNoteId,
        interactionId,
        content: 'Amethyst interaction-only artifact.',
      })
      .execute()
    await insertTestChunk('ai_note', linkedInteractionNoteId, 'amethystinteractionartifact')
    const transitiveArtifact = await searchRecordCandidates('amethystinteractionartifact', {
      mode: 'lexical',
      recordTypes: ['ai_note'],
      relatedTo: [{ recordType: 'document', recordId: documentId }],
    })
    expect(transitiveArtifact.candidates).toEqual([])

    const memory = await createMemory({ claim: 'Citadel transcript evidence subject' })
    await db
      .insertInto('evidenceRefs')
      .values({
        id: newId(),
        subjectType: 'memory',
        subjectId: memory.id,
        chunkId: transcriptChunkId,
      })
      .execute()
    await expectRelatedRef('citadel transcript evidence', `memory:${memory.id}`, [
      { recordType: 'interaction', recordId: interactionId },
    ])
  })

  it('applies polymorphic relation anchors before candidate limits', async () => {
    const personId = await createPerson({ fullName: 'Older source person' })
    const relatedId = await createTask({ title: 'Older sable anchored task' })
    await db
      .updateTable('tasks')
      .set({
        sourceRecordType: 'person',
        sourceRecordId: personId,
        updatedAt: '2020-01-01T09:00:00Z',
      })
      .where('id', '=', relatedId)
      .execute()
    for (let index = 0; index < 20; index += 1) {
      await createTask({ title: `Newer sable task ${index}` })
    }

    const result = await searchRecordCandidates('sable', {
      mode: 'lexical',
      limit: 2,
      recordTypes: ['task'],
      relatedTo: [{ recordType: 'person', recordId: personId }],
    })

    expect(result.candidates.map((candidate) => candidate.recordRef)).toEqual([
      `task:${relatedId}`,
    ])
  })
})

async function expectRelatedRef(query, expectedRef, relatedTo) {
  const result = await searchRecordCandidates(query, { mode: 'lexical', relatedTo })
  expect(result.candidates.map((candidate) => candidate.recordRef)).toContain(expectedRef)
}

async function insertTestChunk(recordType, recordId, text) {
  const id = newId()
  await db
    .insertInto('contentChunks')
    .values({ id, recordType, recordId, chunkIndex: 0, text })
    .execute()
  return id
}
