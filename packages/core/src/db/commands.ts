import type { Compilable, CompiledQuery } from 'kysely'
import { z } from 'zod'
import { call } from '../ipc/invoke'

/**
 * Write bindings for the IPC SQLite bridge.
 *
 * Reads run through the Kysely instance in `client.ts` (the `db_query` runner).
 * Writes never execute through Kysely's driver; instead a domain setter compiles
 * its insert/update/delete to `{ sql, params }` and sends it here, so Rust owns
 * the connection and the transaction. `execute` is one statement; `batch` runs
 * several in a single Rust transaction that rolls back on any failure (use it
 * for multi-table writes).
 */
const affectedSchema = z.number().int().nonnegative()
const affectedListSchema = z.array(affectedSchema)

/** A compiled write statement in transport form. */
export interface DbStatement {
  sql: string
  params: readonly unknown[]
}

function toStatement(compiled: CompiledQuery): DbStatement {
  return { sql: compiled.sql, params: compiled.parameters }
}

/** Execute a single compiled write; resolves to the number of affected rows. */
export function execute(query: Compilable): Promise<number> {
  const statement = toStatement(query.compile())
  return call('db_execute', { sql: statement.sql, params: statement.params }, affectedSchema)
}

/**
 * Execute a raw write statement. For the few writes Kysely cannot express —
 * notably FTS5 maintenance (`INSERT INTO …_fts(…_fts) VALUES('rebuild')`) and
 * hard deletes during maintenance. Reads still go through Kysely.
 */
export function executeRaw(sql: string, params: readonly unknown[] = []): Promise<number> {
  return call('db_execute', { sql, params }, affectedSchema)
}

/**
 * Execute several compiled writes in one Rust transaction. Resolves to the
 * affected-row count per statement; rejects (and rolls back) if any fails.
 */
export function batch(queries: readonly Compilable[]): Promise<number[]> {
  const statements = queries.map((query) => toStatement(query.compile()))
  return call('db_batch', { statements }, affectedListSchema)
}
