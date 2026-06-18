import type { Updateable } from 'kysely'
import type { Memories } from '@local-brain/db'
import { db } from '../../db/client'
import { execute } from '../../db/commands'
import { newId } from '../../db/id'
import { nowIso } from '../../db/time'

/**
 * Correction setters for hidden memories (Plan 05 step 8). Extraction creates
 * memories and `memory_links`; here the user fixes them where they notice a
 * mistake: edit a claim, archive a wrong memory, or unlink it from a record it
 * does not actually concern. Every write is one statement through the Rust-owned
 * connection. Memories are never hard-deleted — archiving keeps provenance and
 * any evidence intact.
 */

export type MemoryPatch = Omit<Updateable<Memories>, 'id' | 'createdAt'>

/** Edit a memory's claim / kind / confidence / validity window. */
export function updateMemory(id: string, patch: MemoryPatch): Promise<number> {
  return execute(
    db
      .updateTable('memories')
      .set({ ...patch, updatedAt: nowIso() })
      .where('id', '=', id),
  )
}

/** Soft-delete a memory; its links and evidence stay for the record. */
export function archiveMemory(id: string): Promise<number> {
  return execute(
    db
      .updateTable('memories')
      .set({ archivedAt: nowIso(), updatedAt: nowIso() })
      .where('id', '=', id),
  )
}

/**
 * Remove a memory's link to a record (e.g. the memory is real but does not
 * concern this person). Deletes only the matching `memory_links` row(s); the
 * memory and its other links survive. Resolves to the number of links removed.
 */
export function unlinkMemoryFromRecord(
  memoryId: string,
  recordType: string,
  recordId: string,
): Promise<number> {
  return execute(
    db
      .deleteFrom('memoryLinks')
      .where('memoryId', '=', memoryId)
      .where('recordType', '=', recordType)
      .where('recordId', '=', recordId),
  )
}

/** Link an existing memory to a record (the inverse of {@link unlinkMemoryFromRecord}). */
export function linkMemoryToRecord(
  memoryId: string,
  recordType: string,
  recordId: string,
  role: string | null = null,
): Promise<number> {
  return execute(
    db.insertInto('memoryLinks').values({ id: newId(), memoryId, recordType, recordId, role }),
  )
}
