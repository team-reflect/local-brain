import type { ReactNode } from 'react'
import { DetailFields } from '../../components/detail-fields'
import { DetailPage } from '../../components/detail-page'
import { LinkedRecords } from '../../components/linked-records'
import { MemoryList } from '../../components/memory-list'
import { PageHead } from '../../components/page-head'
import { RecordInspectionPanel } from '../../components/record-inspection'
import {
  useMemoriesForRecord,
  useOrganization,
  useOrganizationLinks,
  useRecordInspection,
  useUnlinkFrom,
} from '../../lib/queries'

export function OrganizationDetail({ id }: { id: string }): ReactNode {
  const organization = useOrganization(id)
  const links = useOrganizationLinks(id)
  const memories = useMemoriesForRecord('organization', id)
  const inspection = useRecordInspection('organization', id)
  const onUnlink = useUnlinkFrom({ kind: 'organization', id })

  return (
    <DetailPage query={organization} notFoundTitle="Organization not found">
      {(o) => (
        <>
          <PageHead eyebrow="Organization" title={o.name} />
          <DetailFields
            fields={[
              { label: 'Kind', value: o.kind ?? '—' },
              { label: 'Domain', value: o.domain ?? '—' },
              { label: 'Website', value: o.website ?? '—' },
              { label: 'Industry', value: o.industry ?? '—' },
              { label: 'Location', value: o.location ?? '—' },
              { label: 'HQ city', value: o.hqCity ?? '—' },
              { label: 'HQ region', value: o.hqRegion ?? '—' },
              { label: 'HQ country', value: o.hqCountry ?? '—' },
              { label: 'Created', value: o.createdAt.slice(0, 10) },
              { label: 'Updated', value: o.updatedAt.slice(0, 10) },
              { label: 'Archived', value: o.archivedAt?.slice(0, 10) ?? '—' },
            ]}
          />
          {o.summary ? <p className="text-sm text-foreground">{o.summary}</p> : null}
          {o.notes ? <p className="whitespace-pre-wrap text-sm text-foreground">{o.notes}</p> : null}
          {links.data ? (
            <>
              <LinkedRecords title="People" records={links.data.people} onUnlink={onUnlink} />
              <LinkedRecords title="Projects" records={links.data.projects} onUnlink={onUnlink} />
              <LinkedRecords title="Documents" records={links.data.documents} onUnlink={onUnlink} />
              <LinkedRecords title="Interactions" records={links.data.interactions} onUnlink={onUnlink} />
              <LinkedRecords title="Tasks" records={links.data.tasks} onUnlink={onUnlink} />
              <LinkedRecords title="Assets" records={links.data.assets} onUnlink={onUnlink} />
            </>
          ) : null}
          {memories.data ? (
            <MemoryList records={memories.data} recordType="organization" recordId={id} />
          ) : null}
          <RecordInspectionPanel inspection={inspection.data} />
        </>
      )}
    </DetailPage>
  )
}
