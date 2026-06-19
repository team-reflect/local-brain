import type { Insertable, Updateable } from 'kysely'
import type { Database } from '@local-brain/db'
import { db } from './client'
import { execute } from './commands'
import { newId } from './id'
import { nowIso } from './time'

/**
 * Shared shapes for the per-domain create/update payloads.
 *
 * Every product table generates its `id` and lets SQLite fill `created_at` /
 * `updated_at`, and `created_at` is immutable. Rather than repeat the same
 * `Omit<…, 'id' | 'createdAt' | 'updatedAt'>` in each domain's setters, the two
 * generics below encode that contract once. A domain still exports its own named
 * alias (`NewPerson`, `PersonPatch`, …) so call sites read in domain terms.
 */

/** A create payload: an insert row minus the DB-managed `id` and timestamps. */
export type NewRecord<Table> = Omit<Insertable<Table>, 'id' | 'createdAt' | 'updatedAt'>

/** An update payload: any column except the immutable `id` and `createdAt`. */
export type RecordPatch<Table> = Omit<Updateable<Table>, 'id' | 'createdAt'>

/**
 * Tables that follow the standard record contract: a generated TEXT `id`,
 * `created_at`/`updated_at` defaults, and a nullable `archived_at` for
 * soft-delete. The shared mutation helpers below are constrained to these so a
 * caller cannot point them at a join table or the `settings` key/value store.
 */
export type RecordTable =
  | 'people'
  | 'organizations'
  | 'projects'
  | 'tasks'
  | 'documents'
  | 'interactions'
  | 'memories'

// Kysely resolves `insertInto`/`updateTable` to a *union* of per-table builders
// when the table is only known as the `RecordTable` union, and that union's
// `.values()`/`.set()` signatures are mutually incompatible (not callable). The
// table name is therefore narrowed to one representative member so a single
// concrete builder is selected, and the row payload is cast to `never`
// (assignable to every parameter type, and — unlike `any` — allowed by the
// `no-explicit-any` lint). All seven record tables share the `id` / `updated_at`
// / `archived_at` contract these helpers touch, so the runtime SQL is identical
// across them; the public generic signatures keep every call site type-checked.
type AnyRecordTable = 'people'

/** Insert a record with a freshly generated id; resolves to that id. */
export async function insertRecord<T extends RecordTable>(
  table: T,
  values: NewRecord<Database[T]>,
): Promise<string> {
  const id = newId()
  await execute(db.insertInto(table as AnyRecordTable).values({ ...values, id } as never))
  return id
}

/** Apply a patch and stamp `updated_at`; resolves to the affected-row count. */
export function updateRecord<T extends RecordTable>(
  table: T,
  id: string,
  patch: RecordPatch<Database[T]>,
): Promise<number> {
  return execute(
    db
      .updateTable(table as AnyRecordTable)
      .set({ ...patch, updatedAt: nowIso() } as never)
      .where('id', '=', id),
  )
}

/** Soft-delete: stamp `archived_at` (and `updated_at`) so links/history survive. */
export function archiveRecord(table: RecordTable, id: string): Promise<number> {
  return execute(
    db
      .updateTable(table as AnyRecordTable)
      .set({ archivedAt: nowIso(), updatedAt: nowIso() } as never)
      .where('id', '=', id),
  )
}
