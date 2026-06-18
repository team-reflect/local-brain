import { beforeEach, describe, expect, it } from 'vitest'
import { createInteraction, createPerson, completeTask, listPeople } from '../index'
import { captureDbBridge, type CapturedCall } from '../test/bridge'

describe('domain actions', () => {
  let calls: CapturedCall[]

  beforeEach(() => {
    calls = captureDbBridge()
  })

  it('createPerson inserts into people with a generated 26-char id', async () => {
    const id = await createPerson({ fullName: 'Ada Lovelace' })
    expect(id).toHaveLength(26)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.command).toBe('db_execute')
    expect(String(calls[0]?.args['sql'])).toContain('insert into "people"')
    expect(calls[0]?.args['params']).toContain(id)
    expect(calls[0]?.args['params']).toContain('Ada Lovelace')
  })

  it('listPeople hides archived rows and maps snake_case columns to camelCase', async () => {
    calls = captureDbBridge([{ id: 'p1', full_name: 'Ada', is_self: 0 }])
    const people = await listPeople()
    expect(people[0]?.fullName).toBe('Ada')
    const sql = String(calls[0]?.args['sql'])
    expect(sql).toContain('from "people"')
    expect(sql).toContain('"archived_at" is null')
    expect(sql).toContain('order by "full_name"')
  })

  it('completeTask sets status=done through db_execute', async () => {
    await completeTask('t1')
    expect(calls[0]?.command).toBe('db_execute')
    expect(String(calls[0]?.args['sql'])).toContain('update "tasks"')
    expect(calls[0]?.args['params']).toContain('done')
  })

  it('createInteraction with participants writes both tables in one batch', async () => {
    await createInteraction({ kind: 'meeting', title: 'Sync' }, [
      { personId: 'p1', role: 'attendee' },
    ])
    expect(calls[0]?.command).toBe('db_batch')
    const statements = calls[0]?.args['statements'] as Array<{ sql: string }>
    expect(statements).toHaveLength(2)
    expect(statements[0]?.sql).toContain('insert into "interactions"')
    expect(statements[1]?.sql).toContain('insert into "interaction_participants"')
  })
})
