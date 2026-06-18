import type { Selectable } from 'kysely'
import type { Memories } from '@local-brain/db'
import { db } from '../../db/client'

export type Memory = Selectable<Memories>

export interface ListMemoriesOptions {
  includeArchived?: boolean
  limit?: number
}

/** Memories, newest first. */
export function listMemories(options: ListMemoriesOptions = {}): Promise<Memory[]> {
  let query = db.selectFrom('memories').selectAll()
  if (!options.includeArchived) {
    query = query.where('archivedAt', 'is', null)
  }
  query = query.orderBy('createdAt', 'desc')
  if (options.limit !== undefined) {
    query = query.limit(options.limit)
  }
  return query.execute()
}

export function getMemory(id: string): Promise<Memory | undefined> {
  return db.selectFrom('memories').selectAll().where('id', '=', id).executeTakeFirst()
}

/**
 * Memories linked to a record via `memory_links` (e.g. all memories about a
 * person). Newest first, archived excluded.
 */
export function listMemoriesForRecord(recordType: string, recordId: string): Promise<Memory[]> {
  return db
    .selectFrom('memories')
    .innerJoin('memoryLinks', 'memoryLinks.memoryId', 'memories.id')
    .where('memoryLinks.recordType', '=', recordType)
    .where('memoryLinks.recordId', '=', recordId)
    .where('memories.archivedAt', 'is', null)
    .orderBy('memories.createdAt', 'desc')
    .selectAll('memories')
    .execute()
}
