import { describe, expect, it } from 'vitest'
import { createInteraction } from './setters'
import { captureDbBridge } from '../../test/bridge'

interface BatchStatement {
  sql: string
  params: unknown[]
}

function batchStatements(calls: ReturnType<typeof captureDbBridge>): BatchStatement[] {
  const batch = calls.find((call) => call.command === 'db_batch')
  expect(batch, 'expected a db_batch call').toBeDefined()
  return (batch?.args['statements'] as BatchStatement[]) ?? []
}

function participantInserts(statements: BatchStatement[]): BatchStatement[] {
  return statements.filter((statement) => statement.sql.includes('interaction_participants'))
}

const INTERACTION = {
  kind: 'email',
  title: 'Subject',
  bodyText: 'Body',
} as const

describe('createInteraction participant validation', () => {
  it('drops participants that carry no identity (migration 0006 CHECK)', async () => {
    const calls = captureDbBridge()
    await createInteraction(INTERACTION, [
      { role: 'from' }, // role only → invalid
      { role: 'to', handle: '   ' }, // whitespace handle → normalizes away → invalid
      { role: 'cc', displayName: '  ' }, // whitespace display name → invalid
    ])
    const inserts = participantInserts(batchStatements(calls))
    expect(inserts).toHaveLength(0)
  })

  it('keeps and normalizes valid participants', async () => {
    const calls = captureDbBridge()
    await createInteraction(INTERACTION, [
      { role: 'from', handle: 'Robin@Example.com', displayName: '  Robin Spencer  ' },
      { role: 'to', displayName: 'Casey Jordan' },
      { role: 'noise' }, // dropped
    ])
    const inserts = participantInserts(batchStatements(calls))
    expect(inserts).toHaveLength(2)

    // The email handle is lower-cased into normalized_handle and the display
    // name is trimmed.
    const flat = inserts.flatMap((insert) => insert.params)
    expect(flat).toContain('robin@example.com')
    expect(flat).toContain('Robin Spencer')
    expect(flat).toContain('Casey Jordan')
    // The raw whitespace-padded display name is never persisted verbatim.
    expect(flat).not.toContain('  Robin Spencer  ')
  })

  it('keeps a participant identified only by personId', async () => {
    const calls = captureDbBridge()
    await createInteraction(INTERACTION, [{ role: 'from', personId: 'person-1' }])
    const inserts = participantInserts(batchStatements(calls))
    expect(inserts).toHaveLength(1)
    expect(inserts[0]?.params).toContain('person-1')
  })

  it('dedupes identical name-only participants in one create', async () => {
    const calls = captureDbBridge()
    await createInteraction(INTERACTION, [
      { role: 'to', displayName: 'Casey Jordan' },
      { role: 'to', displayName: 'Casey Jordan' }, // exact duplicate → dropped
      { role: 'to', displayName: '  Casey Jordan  ' }, // normalizes to the same → dropped
      { role: 'cc', displayName: 'Casey Jordan' }, // different role → kept
    ])
    const inserts = participantInserts(batchStatements(calls))
    expect(inserts).toHaveLength(2)
    const roles = inserts.map((insert) => insert.params).map((params) => params)
    // One 'to' row and one 'cc' row survive.
    expect(roles.filter((params) => params.includes('to'))).toHaveLength(1)
    expect(roles.filter((params) => params.includes('cc'))).toHaveLength(1)
  })

  it('dedupes duplicate handle and personId participants in one create', async () => {
    const calls = captureDbBridge()
    await createInteraction(INTERACTION, [
      { role: 'from', handle: 'Robin@Example.com' },
      { role: 'from', handle: 'robin@example.com' }, // same normalized handle+role → dropped
      { role: 'to', personId: 'person-1' },
      { role: 'cc', personId: 'person-1' }, // same personId (index ignores role) → dropped
    ])
    const inserts = participantInserts(batchStatements(calls))
    expect(inserts).toHaveLength(2)
    const flat = inserts.flatMap((insert) => insert.params)
    expect(flat.filter((value) => value === 'robin@example.com')).toHaveLength(1)
    expect(flat.filter((value) => value === 'person-1')).toHaveLength(1)
  })
})
