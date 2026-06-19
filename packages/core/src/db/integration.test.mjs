// End-to-end round-trip test for the core domain actions.
//
// This file is .mjs on purpose: it imports Node's built-in `node:sqlite`, which
// has no TypeScript types yet, so it must stay out of the typechecked `src`
// surface. Vitest still runs it. It installs an IPC bridge backed by a real
// in-memory SQLite database (the actual crates/brain-schema migrations), mirroring
// the Rust bridge's JSON->SQLite conversion, then drives the real getters/setters
// and the seed end to end.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  archiveTask,
  completeTask,
  createDocument,
  createInteraction,
  createPerson,
  createTask,
  getDocument,
  getGraph,
  getInteraction,
  getPerson,
  getPersonLinks,
  getSelf,
  ingestDocument,
  ingestInteraction,
  listDocuments,
  listCitationsForSubject,
  listInteractionParticipants,
  listInteractions,
  listMemories,
  listMemoriesForRecord,
  listOrganizations,
  listPeople,
  listTasks,
  quickSearch,
  seedDemoData,
  updateDocument,
  updateInteraction,
  ValidationError,
} from '@local-brain/core'
import { freshDatabase, installSqliteBridge } from './sqlite-harness.mjs'

describe('core domain actions (real SQLite round-trip)', () => {
  beforeEach(() => {
    installSqliteBridge(freshDatabase())
  })

  it('seeds a coherent demo dataset once', async () => {
    expect(await seedDemoData()).toEqual({ seeded: true })
    // Idempotent: a second call is a no-op because people now exist.
    expect(await seedDemoData()).toEqual({ seeded: false })

    const people = await listPeople()
    expect(people).toHaveLength(3)

    const self = await getSelf()
    expect(self?.isSelf).toBe(1)
    expect(self?.fullName).toBe('You')
  })

  it('creates, reads, completes and archives across domains', async () => {
    const personId = await createPerson({ fullName: 'Ada Lovelace' })
    const person = await getPerson(personId)
    expect(person?.fullName).toBe('Ada Lovelace')
    expect(person?.relationshipStrength).toBeNull()
    // SQLite fills created_at/updated_at via the column defaults.
    expect(person?.createdAt).toBeTruthy()

    const interactionId = await createInteraction(
      { kind: 'meeting', title: 'Pairing session' },
      [{ personId, role: 'attendee' }],
    )
    const participants = await listInteractionParticipants(interactionId)
    expect(participants.map((p) => p.id)).toEqual([personId])
  })

  it('completed and archived tasks drop out of the open list', async () => {
    const openTask = await createTask({ title: 'open task' })
    const doneTask = await createTask({ title: 'done task' })
    const archivedTask = await createTask({ title: 'archived task' })

    await completeTask(doneTask)
    await archiveTask(archivedTask)

    const open = await listTasks({ status: 'open' })
    const ids = open.map((task) => task.id)
    expect(ids).toContain(openTask)
    expect(ids).not.toContain(doneTask)
    expect(ids).not.toContain(archivedTask)
  })

  it('rolls the whole interaction back when a participant FK is invalid', async () => {
    await expect(
      createInteraction({ kind: 'meeting', title: 'Doomed' }, [{ personId: 'ghost' }]),
    ).rejects.toBeDefined()

    // The interaction insert must not have persisted (atomic rollback).
    const interactions = await listInteractions()
    expect(interactions).toHaveLength(0)
  })
})

describe('03b read getters (real SQLite round-trip over the seed)', () => {
  let alex

  beforeEach(async () => {
    installSqliteBridge(freshDatabase())
    await seedDemoData()
    const people = await listPeople()
    alex = people.find((person) => person.fullName === 'Alex Rivera')
  })

  it('lists organizations from the seed', async () => {
    const orgs = await listOrganizations()
    expect(orgs.map((org) => org.name)).toEqual(['Northwind Labs'])
  })

  it("assembles a person's linked-record neighborhood across join tables", async () => {
    const links = await getPersonLinks(alex.id)
    expect(links.organizations.map((o) => o.title)).toEqual(['Northwind Labs'])
    expect(links.projects.map((p) => p.title)).toEqual(['Northwind partnership'])
    expect(links.interactions.map((i) => i.title)).toEqual(['Northwind kickoff'])
    // The org link carries the affiliation title as its subtitle.
    expect(links.organizations[0]?.subtitle).toBe('Founder')
  })

  it('reads memories about a record and their supporting citations', async () => {
    const memories = await listMemoriesForRecord('person', alex.id)
    expect(memories.map((m) => m.claim)).toEqual(['Alex Rivera founded Northwind Labs.'])
    expect((await listMemories()).length).toBe(1)

    const citations = await listCitationsForSubject('memory', memories[0].id)
    expect(citations).toHaveLength(1)
    expect(citations[0].sourceType).toBe('document')
    expect(citations[0].sourceTitle).toBe('Northwind kickoff notes')
    expect(citations[0].quote).toContain('partnership proposal')
  })

  it('builds a user-centered graph from the seed', async () => {
    const graph = await getGraph()
    expect(graph.selfId).toBeTruthy()
    expect(graph.truncatedKinds).toEqual([])
    // 3 people + 1 org + 1 project + 2 tasks + 1 doc + 1 interaction + 1 memory.
    expect(graph.nodes).toHaveLength(10)
    expect(graph.nodes.filter((n) => n.kind === 'self')).toHaveLength(1)

    // The self row is the hub: edges to the two other people and the project.
    const fromSelf = graph.edges.filter((e) => e.source === graph.selfId)
    expect(fromSelf.filter((e) => e.kind === 'knows')).toHaveLength(2)
    expect(fromSelf.filter((e) => e.kind === 'owns')).toHaveLength(1)
    // Join-table edges are present and reference real nodes.
    expect(graph.edges.some((e) => e.kind === 'affiliation')).toBe(true)
    expect(graph.edges.some((e) => e.kind === 'memory')).toBe(true)
    const ids = new Set(graph.nodes.map((n) => n.id))
    expect(graph.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true)
  })

  it('quick-searches record names/titles across types', async () => {
    const results = await quickSearch('Northwind')
    const kinds = results.map((r) => r.kind)
    // The seed has a Northwind org, project, task, document, and interaction.
    expect(kinds).toContain('organization')
    expect(kinds).toContain('project')
    expect(kinds).toContain('task')
    expect(kinds).toContain('document')
    expect(kinds).toContain('interaction')
    expect(await quickSearch('   ')).toEqual([])
    expect(await quickSearch('no-such-record-xyz')).toEqual([])
  })

})

describe('04a ingestion (real SQLite round-trip)', () => {
  beforeEach(() => {
    installSqliteBridge(freshDatabase())
  })

  it('ingests a document: normalized body, content chunks, content hash, links', async () => {
    const personId = await createPerson({ fullName: 'Dana Scully' })
    const result = await ingestDocument({
      title: 'Field note',
      bodyText: 'Para one.\r\n\r\n\r\nPara two.   ',
      links: { people: [personId] },
    })

    expect(result.isDuplicate).toBe(false)
    expect(result.chunkCount).toBeGreaterThanOrEqual(1)

    const doc = await getDocument(result.id)
    expect(doc?.bodyText).toBe('Para one.\n\nPara two.')
    expect(doc?.contentHash).toMatch(/^[0-9a-f]{64}$/)

    // The link landed in the same transaction.
    const links = await getPersonLinks(personId)
    expect(links.documents.map((d) => d.id)).toContain(result.id)
  })

  it('detects duplicates by content hash and skips the re-insert', async () => {
    const first = await ingestDocument({ title: 'Note', bodyText: 'Same content.' })
    const second = await ingestDocument({ title: 'Note (again)', bodyText: 'Same content.' })

    expect(second.isDuplicate).toBe(true)
    expect(second.id).toBe(first.id)
    expect(second.chunkCount).toBe(0)
    expect(await listDocuments()).toHaveLength(1)

    // allowDuplicate forces a second copy.
    const forced = await ingestDocument({
      title: 'Note (forced)',
      bodyText: 'Same content.',
      allowDuplicate: true,
    })
    expect(forced.id).not.toBe(first.id)
    expect(await listDocuments()).toHaveLength(2)
  })

  it('ingests an interaction with a participant link and a default kind', async () => {
    const personId = await createPerson({ fullName: 'Fox Mulder' })
    const result = await ingestInteraction({
      title: 'Sync',
      kind: 'meeting',
      bodyText: 'We discussed the case.',
      links: { people: [personId] },
    })

    const participants = await listInteractionParticipants(result.id)
    expect(participants.map((p) => p.id)).toEqual([personId])
    const interaction = await getInteraction(result.id)
    expect(interaction?.kind).toBe('meeting')
    expect(interaction?.contentHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rolls back the whole import when a link FK is invalid', async () => {
    await expect(
      ingestDocument({ title: 'Doomed', bodyText: 'body', links: { people: ['ghost'] } }),
    ).rejects.toBeDefined()
    // Neither the document nor its chunks persisted.
    expect(await listDocuments()).toHaveLength(0)
  })

  it('rejects an ingested document whose paste is only whitespace', async () => {
    await expect(ingestDocument({ title: '   ', bodyText: '  \n\n ' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(await listDocuments()).toHaveLength(0)
  })

  it('keeps a title-only ingested document and stores a null body', async () => {
    const result = await ingestDocument({ title: '  Header   only  ', bodyText: '   ' })
    const doc = await getDocument(result.id)
    expect(doc?.title).toBe('Header only') // squished, not just trimmed
    expect(doc?.bodyText).toBeNull()
    expect(result.chunkCount).toBe(0)
  })

  it('rejects an ingested interaction whose paste is only whitespace', async () => {
    await expect(
      ingestInteraction({ kind: 'note', title: '  ', bodyText: ' \n ' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(await listInteractions()).toHaveLength(0)
  })

  it('validates a whitespace-only duplicate document instead of returning isDuplicate', async () => {
    // A title-only document stores a null body, so its content hash is the
    // empty-body hash. A later whitespace-only paste hashes to the same value,
    // but must still be rejected by the write contract rather than short-circuit
    // to { isDuplicate: true }.
    await ingestDocument({ title: 'Header only', bodyText: '   ' })
    await expect(ingestDocument({ title: '   ', bodyText: '  \n\n ' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(await listDocuments()).toHaveLength(1)

    // A valid duplicate (real body that already exists) still dedupes.
    const first = await ingestDocument({ title: 'Note', bodyText: 'Same content.' })
    const dup = await ingestDocument({ title: 'Note (again)', bodyText: 'Same content.' })
    expect(dup.isDuplicate).toBe(true)
    expect(dup.id).toBe(first.id)
  })

  it('validates a whitespace-only duplicate interaction instead of returning isDuplicate', async () => {
    await ingestInteraction({ kind: 'note', title: 'Header only', bodyText: '   ' })
    await expect(
      ingestInteraction({ kind: 'note', title: '  ', bodyText: ' \n ' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(await listInteractions()).toHaveLength(1)

    // A valid duplicate (real body that already exists) still dedupes.
    const first = await ingestInteraction({ kind: 'note', title: 'Sync', bodyText: 'Same body.' })
    const dup = await ingestInteraction({
      kind: 'note',
      title: 'Sync (again)',
      bodyText: 'Same body.',
    })
    expect(dup.isDuplicate).toBe(true)
    expect(dup.id).toBe(first.id)
  })

  it('refuses an update that clears the only remaining title or body', async () => {
    // Body-only document: clearing the body would leave it empty.
    const bodyOnly = await createDocument({ bodyText: 'The whole story.' })
    await expect(updateDocument(bodyOnly, { bodyText: '   ' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect((await getDocument(bodyOnly))?.bodyText).toBe('The whole story.')

    // Title-only document: clearing the title would leave it empty.
    const titleOnly = await createDocument({ title: 'Just a title' })
    await expect(updateDocument(titleOnly, { title: '  ' })).rejects.toBeInstanceOf(ValidationError)
    expect((await getDocument(titleOnly))?.title).toBe('Just a title')
  })

  it('allows clearing one field when the patch supplies the other', async () => {
    const doc = await createDocument({ title: 'Old title', bodyText: 'Old body.' })
    // Clearing the title is fine because a body remains on the row.
    await updateDocument(doc, { title: '   ' })
    let stored = await getDocument(doc)
    expect(stored?.title).toBeNull()
    expect(stored?.bodyText).toBe('Old body.')

    // Clearing the body is fine when the same patch sets a title.
    await updateDocument(doc, { title: 'Fresh title', bodyText: '  ' })
    stored = await getDocument(doc)
    expect(stored?.title).toBe('Fresh title')
    expect(stored?.bodyText).toBeNull()
  })

  it('refuses an interaction update that clears its only content', async () => {
    const interaction = await createInteraction({ kind: 'note', bodyText: 'Said hello.' })
    await expect(
      updateInteraction(interaction, { bodyText: '   ' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect((await getInteraction(interaction))?.bodyText).toBe('Said hello.')
  })
})
