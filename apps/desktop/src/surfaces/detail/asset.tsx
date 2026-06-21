import type { ReactNode } from 'react'
import { DetailFields } from '../../components/detail-fields'
import { DetailPage } from '../../components/detail-page'
import { LinkedRecords } from '../../components/linked-records'
import { MemoryList } from '../../components/memory-list'
import { PageHead } from '../../components/page-head'
import { RecordInspectionPanel } from '../../components/record-inspection'
import { Section } from '../../components/section'
import {
  useAssetDetail,
  useMemoriesForRecord,
  useRecordInspection,
  useUnlinkFrom,
} from '../../lib/queries'

function bytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function AssetDetail({ id }: { id: string }): ReactNode {
  const detail = useAssetDetail(id)
  const memories = useMemoriesForRecord('asset', id)
  const inspection = useRecordInspection('asset', id)
  const onUnlink = useUnlinkFrom({ kind: 'asset', id })

  return (
    <DetailPage query={detail} notFoundTitle="Asset not found">
      {({ asset, text, linkedRecords }) => (
        <>
          <PageHead
            eyebrow="Asset"
            title={asset.originalFilename ?? asset.storagePath}
          />
          <DetailFields
            fields={[
              { label: 'Kind', value: asset.kind },
              { label: 'MIME type', value: asset.mimeType ?? '—' },
              { label: 'Size', value: bytes(asset.byteSize) },
              { label: 'Content hash', value: asset.contentHash },
              { label: 'Storage path', value: asset.storagePath },
              { label: 'Original file', value: asset.originalFilename ?? '—' },
              { label: 'Original path', value: asset.originalPath ?? '—' },
              { label: 'Original URL', value: asset.originalUrl ?? '—' },
              { label: 'Width', value: asset.width ?? '—' },
              { label: 'Height', value: asset.height ?? '—' },
              { label: 'Text source', value: text?.textSource ?? '—' },
              { label: 'Text length', value: text ? text.textLength.toLocaleString() : '—' },
              { label: 'Created', value: asset.createdAt.slice(0, 10) },
              { label: 'Updated', value: asset.updatedAt.slice(0, 10) },
              { label: 'Archived', value: asset.archivedAt?.slice(0, 10) ?? '—' },
            ]}
          />
          {text ? (
            <Section title="Extracted text">
              <p className="whitespace-pre-wrap text-sm text-foreground">{text.text}</p>
            </Section>
          ) : null}
          <LinkedRecords title="Linked records" records={linkedRecords} onUnlink={onUnlink} />
          {memories.data ? (
            <MemoryList records={memories.data} recordType="asset" recordId={id} />
          ) : null}
          <RecordInspectionPanel inspection={inspection.data} />
        </>
      )}
    </DetailPage>
  )
}
