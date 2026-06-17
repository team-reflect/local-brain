import { describe, expect, it } from 'vitest'
import { createDb } from './db'
import type { QueryRunner } from './dialect'

describe('IpcDialect', () => {
  it('compiles camelCase queries into snake_case SQL and runs them through the runner', async () => {
    const calls: Array<{ sql: string; params: readonly unknown[] }> = []
    const runner: QueryRunner = (sql, params) => {
      calls.push({ sql, params })
      return Promise.resolve([{ value: 'ok' }])
    }

    const db = createDb(runner)
    const rows = await db
      .selectFrom('schemaMeta')
      .select('value')
      .where('key', '=', 'schema_version')
      .execute()

    expect(rows).toEqual([{ value: 'ok' }])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain('"schema_meta"')
    expect(calls[0]?.params).toEqual(['schema_version'])
  })

  it('refuses transactions because writes run in Rust', async () => {
    const db = createDb(() => Promise.resolve([]))
    await expect(db.transaction().execute(() => Promise.resolve())).rejects.toThrow(
      /transactions run in Rust/,
    )
  })

  it('fails fast when the runner returns a non-array', async () => {
    const db = createDb(() => Promise.resolve({ not: 'an array' }))
    await expect(db.selectFrom('schemaMeta').select('value').execute()).rejects.toThrow(
      /did not return a row array/,
    )
  })
})
