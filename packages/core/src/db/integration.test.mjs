// End-to-end round-trip test for the core domain actions.
//
// This file is .mjs on purpose: it imports Node's built-in `node:sqlite`, which
// has no TypeScript types yet, so it must stay out of the typechecked `src`
// surface. Vitest still runs it. It installs an IPC bridge backed by a real
// in-memory SQLite database (the actual crates/brain-schema migrations), mirroring
// the Rust bridge's JSON->SQLite conversion, then drives the real getters/setters
// and the seed end to end.

import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addMessage,
  applyExtraction,
  archiveTask,
  completeTask,
  createConversation,
  createInteraction,
  createPerson,
  createTask,
  getDocument,
  getGraph,
  getInteraction,
  getInteractionLinks,
  getPerson,
  getPersonLinks,
  getSelf,
  getTaskLinks,
  ingestDocument,
  ingestInteraction,
  listDocuments,
  listCitationsForSubject,
  listConversations,
  listInteractionParticipants,
  listInteractions,
  listMemories,
  listMemoriesForRecord,
  listMessages,
  listOrganizations,
  listPeople,
  listTasks,
  parseExtractionResult,
  quickSearch,
  runExtraction,
  seedDemoData,
  setBridge,
  setExtractor,
} from '@local-brain/core'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '..', '..', '..', '..', 'crates', 'brain-schema', 'migrations')

/** Mirror the Rust bridge's json_to_sql: booleans -> 0/1, arrays/objects -> JSON text. */
function toSqlParam(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'object') return JSON.stringify(value)
  return value
}

function freshDatabase() {
  const database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys = ON;')
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    database.exec(readFileSync(join(migrationsDir, file), 'utf8'))
  }
  return database
}

/** An IPC bridge backed by a real SQLite database, like the Rust bridge. */
function installSqliteBridge(database) {
  setBridge({
    invoke(command, args) {
      if (command === 'db_query') {
        const rows = database.prepare(args.sql).all(...args.params.map(toSqlParam))
        return Promise.resolve(rows)
      }
      if (command === 'db_execute') {
        const info = database.prepare(args.sql).run(...args.params.map(toSqlParam))
        return Promise.resolve(Number(info.changes))
      }
      if (command === 'db_batch') {
        database.exec('BEGIN')
        try {
          const affected = args.statements.map((statement) =>
            Number(database.prepare(statement.sql).run(...statement.params.map(toSqlParam)).changes),
          )
          database.exec('COMMIT')
          return Promise.resolve(affected)
        } catch (error) {
          database.exec('ROLLBACK')
          return Promise.reject(error)
        }
      }
      return Promise.reject(new Error(`unexpected command: ${command}`))
    },
  })
}

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
    const personId = await createPerson({ fullName: 'Ada Lovelace', relationshipStrength: 5 })
    const person = await getPerson(personId)
    expect(person?.fullName).toBe('Ada Lovelace')
    expect(person?.relationshipStrength).toBe(5)
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

  it('creates a conversation, appends messages, and reads them back in order', async () => {
    const conversationId = await createConversation('Planning')
    await addMessage({ conversationId, role: 'user', content: 'What is due this week?' })
    await addMessage({ conversationId, role: 'assistant', content: 'Retrieval lands in Plan 06.' })

    const messages = await listMessages(conversationId)
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(messages[0].content).toBe('What is due this week?')

    const conversations = await listConversations()
    expect(conversations.map((c) => c.title)).toEqual(['Planning'])
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
})

describe('05a extraction apply (real SQLite golden round-trip)', () => {
  beforeEach(() => {
    installSqliteBridge(freshDatabase())
    setExtractor(null)
  })

  it('turns a meeting into people, an org, a project, a task, and a cited memory', async () => {
    const meeting = await ingestInteraction({
      kind: 'meeting',
      title: 'Northwind kickoff',
      bodyText:
        'Alex Rivera founded Northwind Labs and pitched the partnership proposal. Dana Scully attended.',
    })

    // A hand-authored result standing in for model output (the contract a model
    // must produce). Refs link entities before any database ids exist.
    const result = parseExtractionResult({
      people: [
        { ref: 'p_alex', fullName: 'Alex Rivera', primaryEmail: 'alex@northwind.com', headline: 'Founder' },
        { ref: 'p_dana', fullName: 'Dana Scully' },
      ],
      organizations: [{ ref: 'o_nw', name: 'Northwind Labs', domain: 'northwind.com' }],
      affiliations: [{ personRef: 'p_alex', organizationRef: 'o_nw', title: 'Founder', isCurrent: true }],
      projects: [{ ref: 'pr_part', name: 'Northwind Partnership', status: 'active' }],
      tasks: [
        {
          ref: 't_prop',
          title: 'Send the partnership proposal',
          status: 'open',
          dueAt: '2026-07-01',
          projectRef: 'pr_part',
          personRefs: ['p_alex'],
          organizationRefs: ['o_nw'],
          evidence: [{ chunkIndex: 0 }],
        },
      ],
      memories: [
        {
          kind: 'fact',
          claim: 'Alex Rivera founded Northwind Labs.',
          confidence: 0.9,
          subjects: [{ ref: 'p_alex', role: 'subject' }, { ref: 'o_nw' }],
          evidence: [{ chunkIndex: 0 }, { chunkIndex: 9 }], // chunk 9 does not exist
        },
      ],
    })

    const summary = await applyExtraction({ recordType: 'interaction', recordId: meeting.id }, result)
    expect(summary.people.created).toBe(2)
    expect(summary.organizations.created).toBe(1)
    expect(summary.projects.created).toBe(1)
    expect(summary.tasks.created).toBe(1)
    expect(summary.affiliations.created).toBe(1)
    expect(summary.memories.created).toBe(1)
    expect(summary.evidence.created).toBe(2) // task chunk 0 + memory chunk 0
    expect(summary.evidence.unresolved).toBe(1) // memory chunk 9

    const people = await listPeople()
    expect(people.map((p) => p.fullName).sort()).toEqual(['Alex Rivera', 'Dana Scully'])
    const alex = people.find((p) => p.fullName === 'Alex Rivera')

    const alexLinks = await getPersonLinks(alex.id)
    expect(alexLinks.organizations.map((o) => o.title)).toEqual(['Northwind Labs'])
    expect(alexLinks.interactions.map((i) => i.title)).toEqual(['Northwind kickoff'])
    expect(alexLinks.tasks.map((t) => t.title)).toEqual(['Send the partnership proposal'])

    const meetingLinks = await getInteractionLinks(meeting.id)
    expect(meetingLinks.organizations.map((o) => o.title)).toEqual(['Northwind Labs'])
    expect(meetingLinks.projects.map((p) => p.title)).toEqual(['Northwind Partnership'])
    expect(meetingLinks.tasks.map((t) => t.title)).toEqual(['Send the partnership proposal'])

    const task = (await listTasks())[0]
    expect(task.originInteractionId).toBe(meeting.id)
    const taskLinks = await getTaskLinks(task.id)
    expect(taskLinks.projects.map((p) => p.title)).toEqual(['Northwind Partnership'])
    expect(taskLinks.people.map((p) => p.title)).toEqual(['Alex Rivera'])
    const taskCitations = await listCitationsForSubject('task', task.id)
    expect(taskCitations).toHaveLength(1)
    expect(taskCitations[0].sourceType).toBe('interaction')

    const memoriesAboutAlex = await listMemoriesForRecord('person', alex.id)
    expect(memoriesAboutAlex.map((m) => m.claim)).toEqual(['Alex Rivera founded Northwind Labs.'])
    const memoryId = memoriesAboutAlex[0].id
    const fromSource = await listMemoriesForRecord('interaction', meeting.id)
    expect(fromSource.map((m) => m.id)).toContain(memoryId)
    const citations = await listCitationsForSubject('memory', memoryId)
    expect(citations).toHaveLength(1)
    expect(citations[0].quote).toContain('partnership proposal')
  })

  it('merges against an existing person and is idempotent on re-apply', async () => {
    const existing = await createPerson({ fullName: 'Alex Rivera', primaryEmail: 'alex@northwind.com' })
    const doc = await ingestDocument({ title: 'Note', bodyText: 'Alex notes.' })
    const result = parseExtractionResult({
      // Different display name, same email -> must merge onto the existing row.
      people: [{ ref: 'p1', fullName: 'Alexander Rivera', primaryEmail: 'ALEX@northwind.com' }],
      memories: [{ kind: 'preference', claim: 'Alex prefers async updates.', subjects: [{ ref: 'p1' }] }],
    })

    const first = await applyExtraction({ recordType: 'document', recordId: doc.id }, result)
    expect(first.people.created).toBe(0)
    expect(first.people.matched).toBe(1)
    expect(first.memories.created).toBe(1)
    expect(await listPeople()).toHaveLength(1)
    expect((await getPersonLinks(existing)).documents.map((d) => d.title)).toEqual(['Note'])

    const second = await applyExtraction({ recordType: 'document', recordId: doc.id }, result)
    expect(second.people.matched).toBe(1)
    expect(second.memories.created).toBe(0)
    expect(second.memories.duplicate).toBe(1)
    expect(second.links.created).toBe(0) // doc + memory links already exist
    expect(await listMemories()).toHaveLength(1)
  })

  it('holds low-confidence entities back as suggestions', async () => {
    const doc = await ingestDocument({ title: 'Tipsheet', bodyText: 'Rumored hire.' })
    const result = parseExtractionResult({
      people: [{ ref: 'p_low', fullName: 'Maybe Person', confidence: 0.2 }],
      memories: [{ claim: 'A confident fact.', confidence: 0.95, subjects: [{ ref: 'p_low' }] }],
    })
    const summary = await applyExtraction({ recordType: 'document', recordId: doc.id }, result, {
      minConfidence: 0.6,
    })

    expect(summary.suggestions.map((s) => s.label)).toContain('Maybe Person')
    expect(summary.people.created).toBe(0)
    expect(await listPeople()).toHaveLength(0)
    // The confident memory still lands; its link to the suppressed person is dropped.
    expect(summary.memories.created).toBe(1)
    expect(await listMemories()).toHaveLength(1)
    expect(await listMemoriesForRecord('document', doc.id)).toHaveLength(1)
  })

  it('runs the pipeline through the extractor seam only when one is registered', async () => {
    const doc = await ingestDocument({ title: 'Standup', bodyText: 'Ship the docs.' })

    // No extractor configured (the Plan 06 default): a no-op, never an error.
    setExtractor(null)
    expect(await runExtraction('document', doc.id)).toBeNull()

    // A registered extractor receives the deterministic context and its output
    // is validated and applied.
    setExtractor((context) => ({
      tasks: [{ ref: 't1', title: `Follow up on ${context.source.title}`, evidence: [{ chunkIndex: 0 }] }],
    }))
    const summary = await runExtraction('document', doc.id)
    expect(summary.tasks.created).toBe(1)
    expect((await listTasks()).map((t) => t.title)).toEqual(['Follow up on Standup'])
    setExtractor(null)
  })
})
