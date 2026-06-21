import { sql } from 'kysely'
import type { Selectable } from 'kysely'
import type { Assets, AssetTexts } from '@local-brain/db'
import { db } from '../../db/client'
import type { LinkedRecord, RecordKind } from '../relations/types'

export type Asset = Selectable<Assets>
export type AssetText = Selectable<AssetTexts>

export interface AssetDetail {
  asset: Asset
  text: Pick<AssetText, 'text' | 'textSource' | 'contentHash' | 'createdAt' | 'updatedAt'> & {
    textLength: number
  } | null
  linkedRecords: LinkedRecord[]
}

interface AssetLinkRow {
  kind: RecordKind
  id: string
  title: string | null
  subtitle: string | null
}

export function getAsset(id: string): Promise<Asset | undefined> {
  return db
    .selectFrom('assets')
    .selectAll()
    .where('id', '=', id)
    .where('archivedAt', 'is', null)
    .executeTakeFirst()
}

export async function getAssetDetail(id: string): Promise<AssetDetail | undefined> {
  const [asset, text, linkedRecords] = await Promise.all([
    getAsset(id),
    db
      .selectFrom('assetTexts')
      .select(({ fn }) => [
        'text',
        'textSource',
        'contentHash',
        'createdAt',
        'updatedAt',
        fn<number>('length', ['text']).as('textLength'),
      ])
      .where('assetId', '=', id)
      .executeTakeFirst(),
    listAssetLinkedRecords(id),
  ])
  if (!asset) return undefined
  return { asset, text: text ?? null, linkedRecords }
}

export async function listAssetLinkedRecords(assetId: string): Promise<LinkedRecord[]> {
  const rows = await sql<AssetLinkRow>`
    SELECT al.record_type AS "kind",
           al.record_id AS "id",
           COALESCE(p.full_name, o.name, pr.name, t.title, d.title, i.title) AS "title",
           COALESCE(p.headline, o.kind, pr.status, t.status, d.kind, i.kind, al.role) AS "subtitle"
    FROM asset_links al
    LEFT JOIN people p
      ON al.record_type = 'person' AND p.id = al.record_id AND p.archived_at IS NULL
    LEFT JOIN organizations o
      ON al.record_type = 'organization' AND o.id = al.record_id AND o.archived_at IS NULL
    LEFT JOIN projects pr
      ON al.record_type = 'project' AND pr.id = al.record_id AND pr.archived_at IS NULL
    LEFT JOIN tasks t
      ON al.record_type = 'task' AND t.id = al.record_id AND t.archived_at IS NULL
    LEFT JOIN documents d
      ON al.record_type = 'document' AND d.id = al.record_id AND d.archived_at IS NULL
    LEFT JOIN interactions i
      ON al.record_type = 'interaction' AND i.id = al.record_id AND i.archived_at IS NULL
    WHERE al.asset_id = ${assetId}
    ORDER BY al.created_at ASC, al.id ASC
  `.execute(db)

  return rows.rows.map((row) => ({
    kind: row.kind,
    id: row.id,
    title: row.title ?? '(untitled)',
    subtitle: row.subtitle,
  }))
}
