import type { Selectable } from 'kysely'
import type { Documents } from '@local-brain/db'
import { db } from '../../db/client'

export type Document = Selectable<Documents>

export interface ListDocumentsOptions {
  includeArchived?: boolean
  limit?: number
}

/** Documents, most recently authored/created first. */
export function listDocuments(options: ListDocumentsOptions = {}): Promise<Document[]> {
  let query = db.selectFrom('documents').selectAll()
  if (!options.includeArchived) {
    query = query.where('archivedAt', 'is', null)
  }
  query = query.orderBy('createdAt', 'desc')
  if (options.limit !== undefined) {
    query = query.limit(options.limit)
  }
  return query.execute()
}

export function getDocument(id: string): Promise<Document | undefined> {
  return db.selectFrom('documents').selectAll().where('id', '=', id).executeTakeFirst()
}
