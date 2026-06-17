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
  archiveTask,
  completeTask,
  createInteraction,
  createPerson,
  createTask,
  getPerson,
  getSelf,
  listInteractionParticipants,
  listInteractions,
  listPeople,
  listTasks,
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
