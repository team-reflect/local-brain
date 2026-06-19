import type { ReactNode } from 'react'
import { DetailFields } from '../../components/detail-fields'
import { DetailPage } from '../../components/detail-page'
import { LinkedRecords } from '../../components/linked-records'
import { PageHead } from '../../components/page-head'
import { useAssetDetail, useUnlinkFrom } from '../../lib/queries'

function bytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function AssetDetail({ id }: { id: string }): ReactNode {
  const detail = useAssetDetail(id)
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
              { label: 'Storage path', value: asset.storagePath },
              { label: 'Original URL', value: asset.originalUrl ?? '—' },
              { label: 'Text source', value: text?.textSource ?? '—' },
              { label: 'Text length', value: text ? text.textLength.toLocaleString() : '—' },
            ]}
          />
          <LinkedRecords title="Linked records" records={linkedRecords} onUnlink={onUnlink} />
        </>
      )}
    </DetailPage>
  )
}
