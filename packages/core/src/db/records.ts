import type { Insertable, Updateable } from 'kysely'

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
