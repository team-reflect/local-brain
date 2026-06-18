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
  archiveTask,
  completeTask,
  createConversation,
  createInteraction,
  createPerson,
  createTask,
  getGraph,
  getPerson,
  getPersonLinks,
  getSelf,
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
  quickSearch,
  seedDemoData,
  setBridge,
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
