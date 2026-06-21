import { beforeEach, describe, expect, it } from 'vitest'
import {
  createInteraction,
  createMemory,
  createPerson,
  completeTask,
  listPeople,
  setAiProvidersState,
  updateTask,
} from '../index'
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
    expect(sql).toContain('left join "relationship_strengths"')
    expect(sql).toContain('"archived_at" is null')
    expect(sql).toContain('order by "people"."full_name"')
  })

  it('completeTask sets status=done through db_execute', async () => {
    await completeTask('t1')
    expect(calls[0]?.command).toBe('db_execute')
    expect(String(calls[0]?.args['sql'])).toContain('update "tasks"')
    expect(calls[0]?.args['params']).toContain('done')
  })

  it('updateTask patches tasks and stamps updated_at', async () => {
    await updateTask('t1', { title: '  Ship it ', status: 'waiting' })
    expect(calls[0]?.command).toBe('db_execute')
    expect(String(calls[0]?.args['sql'])).toContain('update "tasks"')
    expect(String(calls[0]?.args['sql'])).toContain('"updated_at"')
    expect(calls[0]?.args['params']).toContain('t1')
    expect(calls[0]?.args['params']).toContain('Ship it')
    expect(calls[0]?.args['params']).toContain('waiting')
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

  it('createMemory inserts a memory and links in one batch', async () => {
    const result = await createMemory(
      { claim: '  Alex prefers async updates.  ', kind: 'preference' },
      [{ recordType: 'person', recordId: 'p1', role: 'subject' }],
    )

    expect(result.created).toBe(true)
    expect(result.id).toHaveLength(26)
    expect(calls[0]?.command).toBe('db_query')
    expect(calls[1]?.command).toBe('db_batch')
    const statements = calls[1]?.args['statements'] as Array<{ sql: string; params: unknown[] }>
    expect(statements).toHaveLength(2)
    expect(statements[0]?.sql).toContain('insert into "memories"')
    expect(statements[0]?.params).toContain('Alex prefers async updates.')
    expect(statements[1]?.sql).toContain('insert into "memory_links"')
    expect(statements[1]?.params).toContain('p1')
  })

  it('createMemory returns an active duplicate claim instead of inserting', async () => {
    calls = captureDbBridge([{ id: 'memory-1', claim: 'Alex prefers async updates.' }])

    const result = await createMemory({ claim: ' alex prefers async updates. ' })

    expect(result).toEqual({ id: 'memory-1', created: false })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.command).toBe('db_query')
  })

  it('setAiProvidersState writes provider list and default in one batch', async () => {
    await setAiProvidersState(
      [{ id: 'cfg-a', provider: 'anthropic', model: 'claude-sonnet-4-6', keyHint: 'abcde' }],
      'cfg-a',
    )
    expect(calls[0]?.command).toBe('db_batch')
    const statements = calls[0]?.args['statements'] as Array<{ sql: string; params: unknown[] }>
    expect(statements).toHaveLength(2)
    expect(statements[0]?.sql).toContain('insert into "settings"')
    expect(statements[0]?.params).toContain('model.aiProviders')
    expect(statements[1]?.params).toContain('model.defaultAiProviderId')
  })
})
