// Real-SQLite round-trip tests for Plan 05b: correction setters (unlink/edit/
// archive a memory or link, fix a citation) and relationship-intelligence
// recompute. Shares the in-memory SQLite harness with the other .mjs suites; it
// is .mjs for the same reason (the node:sqlite-backed bridge).

import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyExtraction,
  archiveMemory,
  createInteraction,
  createPerson,
  createProject,
  db,
  execute,
  getMemory,
  getPerson,
  getPersonLinks,
  getTask,
  getTaskLinks,
  ingestDocument,
  ingestInteraction,
  listCitationsForSubject,
  listMemories,
  listMemoriesForRecord,
  listPeople,
  listTasks,
  parseExtractionResult,
  recomputeAllRelationships,
  recomputeRelationshipIntelligence,
  removeEvidenceRef,
  unlinkMemoryFromRecord,
  unlinkRecords,
  updateEvidenceRef,
  updateMemory,
} from '@local-brain/core'
import { freshDatabase, installSqliteBridge } from './sqlite-harness.mjs'

describe('05b correction setters (real SQLite)', () => {
  beforeEach(() => {
    installSqliteBridge(freshDatabase())
  })

  it('severs a person↔organization affiliation, leaving both records intact', async () => {
    const meeting = await ingestInteraction({
      kind: 'meeting',
      title: 'Kickoff',
      bodyText: 'Alex Rivera founded Northwind Labs.',
    })
    await applyExtraction(
      { recordType: 'interaction', recordId: meeting.id },
      parseExtractionResult({
        people: [{ ref: 'p', fullName: 'Alex Rivera', primaryEmail: 'alex@northwind.com' }],
        organizations: [{ ref: 'o', name: 'Northwind Labs', domain: 'northwind.com' }],
        affiliations: [{ personRef: 'p', organizationRef: 'o', title: 'Founder', isCurrent: true }],
      }),
    )

    const alexId = (await listPeople()).find((p) => p.fullName === 'Alex Rivera').id
    const links = await getPersonLinks(alexId)
    expect(links.organizations.map((o) => o.title)).toEqual(['Northwind Labs'])
    const orgId = links.organizations[0].id

    const removed = await unlinkRecords({ kind: 'person', id: alexId }, { kind: 'organization', id: orgId })
    expect(removed).toBe(1)
    const after = await getPersonLinks(alexId)
    expect(after.organizations).toHaveLength(0)
    // Both records survive — only the affiliation row was deleted.
    expect((await getPerson(alexId))?.fullName).toBe('Alex Rivera')
  })

  it('unlinks a task from its project by clearing tasks.project_id (order-independent)', async () => {
    const doc = await ingestDocument({ title: 'Plan', bodyText: 'Apollo needs a kickoff.' })
    await createProject({ name: 'Apollo' })
    await applyExtraction(
      { recordType: 'document', recordId: doc.id },
      parseExtractionResult({
        projects: [{ ref: 'pr', name: 'Apollo' }],
        tasks: [{ ref: 't', title: 'Kick off Apollo', projectRef: 'pr' }],
      }),
    )
    const task = (await listTasks())[0]
    const projectId = (await getTaskLinks(task.id)).projects[0].id

    // Pass the records in the "wrong" order to prove lookup is undirected.
    const affected = await unlinkRecords({ kind: 'task', id: task.id }, { kind: 'project', id: projectId })
    expect(affected).toBe(1)
    expect((await getTaskLinks(task.id)).projects).toHaveLength(0)
    // The task itself still exists; only its project_id was cleared.
    expect((await getTask(task.id))?.projectId).toBeNull()
  })

  it('unlinks a person from a document join row', async () => {
    const personId = await createPerson({ fullName: 'Dana Scully' })
    const doc = await ingestDocument({
      title: 'Brief',
      bodyText: 'Notes about Dana.',
      links: { people: [personId] },
    })
    expect((await getPersonLinks(personId)).documents.map((d) => d.id)).toContain(doc.id)

    await unlinkRecords({ kind: 'document', id: doc.id }, { kind: 'person', id: personId })
    expect((await getPersonLinks(personId)).documents).toHaveLength(0)
  })

  it('edits a memory, unlinks it from one record, then archives it', async () => {
    const meeting = await ingestInteraction({
      kind: 'meeting',
      title: 'Kickoff',
      bodyText: 'Alex founded Northwind.',
    })
    await applyExtraction(
      { recordType: 'interaction', recordId: meeting.id },
      parseExtractionResult({
        people: [{ ref: 'p', fullName: 'Alex Rivera', primaryEmail: 'a@nw.com' }],
        memories: [
          {
            kind: 'fact',
            claim: 'Alex founded Northwind.',
            subjects: [{ ref: 'p' }],
            evidence: [{ chunkIndex: 0 }],
          },
        ],
      }),
    )
    const memory = (await listMemoriesForRecord('interaction', meeting.id))[0]
    expect(memory.claim).toBe('Alex founded Northwind.')

    await updateMemory(memory.id, { claim: 'Alex co-founded Northwind.' })
    expect((await getMemory(memory.id))?.claim).toBe('Alex co-founded Northwind.')

    // Unlink from the source interaction; the memory + its person link survive.
    const removed = await unlinkMemoryFromRecord(memory.id, 'interaction', meeting.id)
    expect(removed).toBe(1)
    expect(await listMemoriesForRecord('interaction', meeting.id)).toHaveLength(0)
    expect((await getMemory(memory.id))?.archivedAt).toBeNull()

    await archiveMemory(memory.id)
    expect((await getMemory(memory.id))?.archivedAt).toBeTruthy()
    expect(await listMemories()).toHaveLength(0)
  })

  it('fixes a citation: edits the note then removes a wrong evidence ref', async () => {
    const meeting = await ingestInteraction({
      kind: 'meeting',
      title: 'Kickoff',
      bodyText: 'Alex owns the proposal.',
    })
    await applyExtraction(
      { recordType: 'interaction', recordId: meeting.id },
      parseExtractionResult({
        people: [{ ref: 'p', fullName: 'Alex Rivera', primaryEmail: 'a@nw.com' }],
        memories: [
          {
            kind: 'commitment',
            claim: 'Alex owns the proposal.',
            subjects: [{ ref: 'p' }],
            evidence: [{ chunkIndex: 0 }],
          },
        ],
      }),
    )
    const memory = (await listMemories())[0]
    let citations = await listCitationsForSubject('memory', memory.id)
    expect(citations).toHaveLength(1)

    await updateEvidenceRef(citations[0].id, { note: 'Confirmed by Alex' })
    citations = await listCitationsForSubject('memory', memory.id)
    expect(citations[0].note).toBe('Confirmed by Alex')

    await removeEvidenceRef(citations[0].id)
    expect(await listCitationsForSubject('memory', memory.id)).toHaveLength(0)
    // Removing evidence doesn't touch the grounded memory.
    expect((await getMemory(memory.id))?.claim).toBe('Alex owns the proposal.')
  })
})

describe('05b relationship intelligence recompute (real SQLite)', () => {
  let sqlite

  beforeEach(() => {
    sqlite = freshDatabase()
    installSqliteBridge(sqlite)
  })

  it('derives last-interaction and strength from interactions', async () => {
    const personId = await createPerson({ fullName: 'Ada Lovelace' })
    await createInteraction(
      { kind: 'meeting', title: 'Older sync', occurredAt: '2026-03-01T10:00:00.000Z' },
      [{ personId }],
    )
    await createInteraction(
      { kind: 'meeting', title: 'Recent sync', occurredAt: '2026-05-20T10:00:00.000Z' },
      [{ personId }],
    )

    // createInteraction already recomputes (at real "now"); pin asOf for asserts.
    await recomputeRelationshipIntelligence(personId, { asOf: '2026-06-01T00:00:00.000Z' })
    const person = await getPerson(personId)
    expect(person?.lastInteractionAt).toBe('2026-05-20T10:00:00.000Z')
    // 2 recent interactions (+2), last seen 12d ago (+3) -> score 5 -> bucket 3.
    expect(person?.relationshipStrength).toBe(3)
  })

  it('counts shared open tasks toward strength', async () => {
    const personId = await createPerson({ fullName: 'Grace Hopper' })
    const doc = await ingestDocument({ title: 'Plan', bodyText: 'Grace will do A and B.' })
    await applyExtraction(
      { recordType: 'document', recordId: doc.id },
      parseExtractionResult({
        people: [{ ref: 'p', fullName: 'Grace Hopper' }],
        tasks: [
          { ref: 'a', title: 'Do A', personRefs: ['p'] },
          { ref: 'b', title: 'Do B', personRefs: ['p'] },
        ],
      }),
    )
    expect((await getPersonLinks(personId)).tasks).toHaveLength(2)

    await recomputeRelationshipIntelligence(personId, { asOf: '2026-06-01T00:00:00.000Z' })
    // No interactions, 2 open tasks -> score 2 -> bucket 2 (not null).
    expect((await getPerson(personId))?.relationshipStrength).toBe(2)
  })

  it('leaves strength null for a person with no deterministic signal', async () => {
    const personId = await createPerson({ fullName: 'Unknown Contact' })
    await recomputeRelationshipIntelligence(personId, { asOf: '2026-06-01T00:00:00.000Z' })
    const person = await getPerson(personId)
    expect(person?.relationshipStrength).toBeNull()
    expect(person?.lastInteractionAt).toBeNull()
  })

  it('does not expose a writable people.relationship_strength column', async () => {
    expect(() =>
      sqlite
        .prepare("INSERT INTO people (id, full_name, relationship_strength) VALUES ('p_manual', 'Manual', 4)")
        .run(),
    ).toThrow(/relationship_strength/)
  })

  it('computes strength from non-archived interactions', async () => {
    const personId = await createPerson({ fullName: 'Archived Latest' })
    await createInteraction({ kind: 'call', title: 'old', occurredAt: '2026-01-01T00:00:00.000Z' }, [
      { personId },
    ])
    const latest = await createInteraction({ kind: 'call', title: 'archived', occurredAt: '2026-05-10T00:00:00.000Z' }, [
      { personId },
    ])
    await recomputeAllRelationships({ asOf: '2026-06-01T00:00:00.000Z' })

    await execute(
      db
        .updateTable('interactions')
        .set({ archivedAt: '2026-05-20T00:00:00.000Z' })
        .where('id', '=', latest),
    )

    await recomputeAllRelationships({ asOf: '2026-06-01T00:00:00.000Z' })
    const person = await getPerson(personId)
    expect(person?.lastInteractionAt).toBe('2026-01-01T00:00:00.000Z')
    expect(person?.relationshipStrength).toBe(2)
  })
})
