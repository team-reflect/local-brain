import { SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler } from 'kysely'
import type {
  CompiledQuery,
  DatabaseConnection,
  Dialect,
  Driver,
  Kysely,
  QueryResult,
} from 'kysely'

/**
 * Runs a compiled query against the Rust-owned SQLite connection. The desktop
 * app injects a runner that forwards `{ sql, params }` to the `db_query` Tauri
 * command; the CLI/tests inject their own. Kysely compiles the SQL in
 * TypeScript; Rust executes it (see architecture-conventions.md).
 */
export type QueryRunner = (sql: string, params: readonly unknown[]) => Promise<unknown>

/**
 * A Kysely dialect that executes reads against the SQLite brain living in the
 * Rust process. Writes do NOT go through here — multi-table writes use named
 * Rust commands that own their own transactions — so this is a read-only bridge
 * and transactions are intentionally unsupported.
 */
class IpcConnection implements DatabaseConnection {
  constructor(private readonly runQuery: QueryRunner) {}

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    const rows = await this.runQuery(compiled.sql, compiled.parameters)
    // Rows are our own projection (Rust serializes from a known schema), so we
    // deliberately don't zod-parse every row in hot paths. A cheap O(1) shape
    // check still fails fast at the boundary rather than deep in a consumer.
    if (!Array.isArray(rows)) {
      throw new Error('db_query did not return a row array')
    }
    return { rows: rows as R[] }
  }

  // eslint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('streaming is not supported over the IPC SQLite bridge')
  }
}

class IpcDriver implements Driver {
  constructor(private readonly connection: IpcConnection) {}

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    return this.connection
  }

  async beginTransaction(): Promise<void> {
    throw new Error('transactions run in Rust (named write commands), not via Kysely')
  }

  async commitTransaction(): Promise<void> {
    throw new Error('transactions run in Rust (named write commands), not via Kysely')
  }

  async rollbackTransaction(): Promise<void> {
    throw new Error('transactions run in Rust (named write commands), not via Kysely')
  }

  async releaseConnection(): Promise<void> {}

  async destroy(): Promise<void> {}
}

/** The read-only SQLite dialect for the local brain, over an injected runner. */
export class IpcDialect implements Dialect {
  private readonly connection: IpcConnection

  constructor(runQuery: QueryRunner) {
    this.connection = new IpcConnection(runQuery)
  }

  createAdapter(): SqliteAdapter {
    return new SqliteAdapter()
  }

  createDriver(): Driver {
    return new IpcDriver(this.connection)
  }

  createQueryCompiler(): SqliteQueryCompiler {
    return new SqliteQueryCompiler()
  }

  createIntrospector(db: Kysely<unknown>): SqliteIntrospector {
    return new SqliteIntrospector(db)
  }
}
