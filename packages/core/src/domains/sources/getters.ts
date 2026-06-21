import type { Selectable } from 'kysely'
import type { ExternalIdentities, RecordProvenance, Sources } from '@local-brain/db'
import { db } from '../../db/client'

export type Source = Selectable<Sources>
export type ExternalIdentity = Selectable<ExternalIdentities>
export type RecordProvenanceRow = Selectable<RecordProvenance>

export type ExternalIdentitySummary = ExternalIdentity & {
  sourceName: string | null
  sourceSlug: string | null
}

export type RecordProvenanceSummary = RecordProvenanceRow & {
  sourceName: string | null
  sourceSlug: string | null
  externalKind: string | null
  externalId: string | null
  externalUrl: string | null
}

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

export function listExternalIdentitySummariesForRecord(
  entityType: string,
  entityId: string,
): Promise<ExternalIdentitySummary[]> {
  return db
    .selectFrom('externalIdentities')
    .leftJoin('sources', 'sources.id', 'externalIdentities.sourceId')
    .selectAll('externalIdentities')
    .select(['sources.name as sourceName', 'sources.slug as sourceSlug'])
    .where('externalIdentities.entityType', '=', entityType)
    .where('externalIdentities.entityId', '=', entityId)
    .orderBy('sources.slug', 'asc')
    .orderBy('externalIdentities.kind', 'asc')
    .execute()
}

export function listRecordProvenanceForRecord(
  recordType: string,
  recordId: string,
): Promise<RecordProvenanceSummary[]> {
  return db
    .selectFrom('recordProvenance')
    .leftJoin('sources', 'sources.id', 'recordProvenance.sourceId')
    .leftJoin(
      'externalIdentities',
      'externalIdentities.id',
      'recordProvenance.externalIdentityId',
    )
    .selectAll('recordProvenance')
    .select([
      'sources.name as sourceName',
      'sources.slug as sourceSlug',
      'externalIdentities.kind as externalKind',
      'externalIdentities.externalId as externalId',
      'externalIdentities.url as externalUrl',
    ])
    .where('recordProvenance.recordType', '=', recordType)
    .where('recordProvenance.recordId', '=', recordId)
    .orderBy('recordProvenance.importedAt', 'desc')
    .orderBy('recordProvenance.createdAt', 'desc')
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
