import type { Selectable } from 'kysely'
import type { ExternalIdentities, Sources } from '@local-brain/db'
import { db } from '../../db/client'

export type Source = Selectable<Sources>
export type ExternalIdentity = Selectable<ExternalIdentities>

export function listSources(): Promise<Source[]> {
  return db.selectFrom('sources').selectAll().orderBy('slug', 'asc').execute()
}

export function getSourceBySlug(slug: string): Promise<Source | undefined> {
  return db
    .selectFrom('sources')
    .selectAll()
    .where('slug', '=', slug.trim().toLowerCase())
    .executeTakeFirst()
}

export function listExternalIdentitiesForRecord(
  entityType: string,
  entityId: string,
): Promise<ExternalIdentity[]> {
  return db
    .selectFrom('externalIdentities')
    .selectAll()
    .where('entityType', '=', entityType)
    .where('entityId', '=', entityId)
    .orderBy('createdAt', 'asc')
    .execute()
}

export function getExternalIdentity(
  sourceId: string,
  kind: string,
  externalId: string,
): Promise<ExternalIdentity | undefined> {
  return db
    .selectFrom('externalIdentities')
    .selectAll()
    .where('sourceId', '=', sourceId)
    .where('kind', '=', kind)
    .where('externalId', '=', externalId)
    .executeTakeFirst()
}
