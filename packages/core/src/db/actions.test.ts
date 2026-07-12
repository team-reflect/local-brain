import { beforeEach, describe, expect, it } from 'vitest'
import {
  createInteraction,
  createMemory,
  createPerson,
  completeTask,
  listPeople,
  setBridge,
  setAiProvidersState,
  updateMemory,
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
    const batchCall = calls.find((call) => call.command === 'db_batch')
    const statements = batchCall?.args['statements'] as Array<{ sql: string }>
    expect(statements.some((statement) => statement.sql.includes('insert into "interactions"'))).toBe(true)
    expect(statements.some((statement) => statement.sql.includes('insert into "interaction_participants"'))).toBe(true)
    expect(statements.some((statement) => statement.sql.includes('delete from "content_chunks"'))).toBe(true)
  })

  it('createMemory inserts a memory and links in one batch', async () => {
    const result = await createMemory(
      { claim: '  Alex prefers async updates.  ', kind: 'preference' },
      [{ recordType: 'person', recordId: 'p1', role: 'subject' }],
    )

    expect(result.created).toBe(true)
    expect(result.id).toHaveLength(26)
    expect(calls[0]?.command).toBe('active_database_identity')
    const batchCall = calls.find((call) => call.command === 'db_batch')
    const statements = batchCall?.args['statements'] as Array<{ sql: string; params: unknown[] }>
    expect(statements.find((statement) => statement.sql.includes('insert into "memories"'))?.params).toContain(
      'Alex prefers async updates.',
    )
    expect(statements.find((statement) => statement.sql.includes('insert into "memory_links"'))?.params).toContain(
      'p1',
    )
    expect(statements.some((statement) => statement.sql.includes('insert into "content_chunks"'))).toBe(true)
  })

  it('createMemory returns an active duplicate claim instead of inserting', async () => {
    calls = captureDbBridge([{ id: 'memory-1', claim: 'Alex   prefers   async updates.' }])

    const result = await createMemory({ claim: ' alex prefers async updates. ' })

    expect(result).toEqual({ id: 'memory-1', created: false })
    expect(calls.map((call) => call.command)).toEqual([
      'active_database_identity',
      'db_query',
      'db_query',
      'db_batch',
    ])
  })

  it('createMemory links active duplicate claims to new subjects', async () => {
    calls = captureDbBridge([{ id: 'memory-1', claim: 'Alex prefers async updates.' }])

    const result = await createMemory({ claim: ' alex prefers async updates. ' }, [
      { recordType: 'person', recordId: 'p2', role: 'subject' },
    ])

    expect(result).toEqual({ id: 'memory-1', created: false })
    expect(calls).toHaveLength(6)
    expect(calls[0]?.command).toBe('active_database_identity')
    expect(String(calls[1]?.args['sql'])).toContain('from "memories"')
    expect(String(calls[2]?.args['sql'])).toContain('from "memory_links"')
    expect(calls[3]?.command).toBe('db_batch')
    const statements = calls[3]?.args['statements'] as Array<{ sql: string; params: unknown[] }>
    expect(statements).toHaveLength(1)
    expect(statements[0]?.sql).toContain('insert into "memory_links"')
    expect(statements[0]?.params).toContain('memory-1')
    expect(statements[0]?.params).toContain('p2')
  })

  it('createMemory serializes duplicate checks before inserting', async () => {
    const commands: string[] = []
    let memoryQueryCount = 0
    let createdMemoryId = ''
    let releaseFirstQuery!: () => void
    let firstQueryStarted!: () => void
    const firstQueryStartedPromise = new Promise<void>((resolve) => {
      firstQueryStarted = resolve
    })
    const firstQueryGate = new Promise<void>((resolve) => {
      releaseFirstQuery = resolve
    })

    setBridge({
      invoke: (command, args) => {
        commands.push(command)
        if (command === 'active_database_identity') {
          return Promise.resolve({ databasePath: '/test/brain.sqlite', generation: 1 })
        }
        if (command === 'db_query' && String(args['sql']).includes('from "memories"')) {
          memoryQueryCount += 1
          if (memoryQueryCount === 1) {
            firstQueryStarted()
            return firstQueryGate.then(() => [])
          }
          return Promise.resolve([{ id: createdMemoryId, claim: 'Same claim' }])
        }
        if (command === 'db_query') return Promise.resolve([])
        if (command === 'db_batch') {
          const statements = args['statements'] as Array<{ sql: string; params: readonly unknown[] }>
          const memoryInsert = statements.find((statement) => statement.sql.includes('insert into "memories"'))
          const firstStringParam = memoryInsert?.params.find(
            (param) => typeof param === 'string' && param.length === 26,
          )
          if (typeof firstStringParam === 'string') createdMemoryId = firstStringParam
          return Promise.resolve(statements.map(() => 1))
        }
        return Promise.resolve(1)
      },
    })

    const first = createMemory({ claim: 'Same claim' })
    await firstQueryStartedPromise
    const second = createMemory({ claim: ' same   claim ' })
    await Promise.resolve()

    expect(memoryQueryCount).toBe(1)
    expect(commands).toEqual(['active_database_identity', 'db_query'])
    releaseFirstQuery()
    const [created, duplicate] = await Promise.all([first, second])

    expect(created).toEqual({ id: createdMemoryId, created: true })
    expect(duplicate).toEqual({ id: createdMemoryId, created: false })
    expect(commands).toEqual([
      'active_database_identity',
      'db_query',
      'db_batch',
      'active_database_identity',
      'db_query',
      'db_query',
      'db_batch',
    ])
  })

  it('updateMemory normalizes claim patches', async () => {
    await updateMemory('memory-1', { claim: '  Same   claim  ' })

    expect(calls[0]?.command).toBe('active_database_identity')
    const executeCall = calls.find((call) => call.command === 'db_execute')
    expect(executeCall?.command).toBe('db_execute')
    expect(String(executeCall?.args['sql'])).toContain('update "memories"')
    expect(executeCall?.args['params']).toContain('Same claim')
  })

  it('updateMemory rejects duplicate active claims', async () => {
    calls = captureDbBridge([{ id: 'memory-2', claim: 'Same   claim' }])

    await expect(updateMemory('memory-1', { claim: ' same claim ' })).rejects.toThrow(
      'An active memory with this claim already exists.',
    )

    expect(calls).toHaveLength(2)
    expect(calls[0]?.command).toBe('active_database_identity')
    expect(calls[1]?.command).toBe('db_query')
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
