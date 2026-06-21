import type { ReactNode } from 'react'
import { DetailFields } from '../../components/detail-fields'
import { DetailPage } from '../../components/detail-page'
import { LinkedRecords } from '../../components/linked-records'
import { MemoryList } from '../../components/memory-list'
import { PageHead } from '../../components/page-head'
import { RecordInspectionPanel } from '../../components/record-inspection'
import {
  useMemoriesForRecord,
  usePerson,
  usePersonLinks,
  useRecordInspection,
  useUnlinkFrom,
} from '../../lib/queries'

export function PersonDetail({ id }: { id: string }): ReactNode {
  const person = usePerson(id)
  const links = usePersonLinks(id)
  const memories = useMemoriesForRecord('person', id)
  const inspection = useRecordInspection('person', id)
  const onUnlink = useUnlinkFrom({ kind: 'person', id })

  return (
    <DetailPage query={person} notFoundTitle="Person not found">
      {(p) => (
        <>
          <PageHead eyebrow={p.isSelf ? 'You' : 'Person'} title={p.fullName} />
          <DetailFields
            fields={[
              { label: 'Headline', value: p.headline ?? '—' },
              { label: 'Preferred', value: p.preferredName ?? '—' },
              { label: 'Email', value: p.primaryEmail ?? '—' },
              { label: 'Phone', value: p.primaryPhone ?? '—' },
              { label: 'Location', value: p.location ?? '—' },
              { label: 'City', value: p.city ?? '—' },
              { label: 'Region', value: p.region ?? '—' },
              { label: 'Country', value: p.country ?? '—' },
              { label: 'Timezone', value: p.timezone ?? '—' },
              { label: 'LinkedIn', value: p.linkedinUrl ?? '—' },
              { label: 'Website', value: p.website ?? '—' },
              { label: 'Title', value: p.currentTitle ?? '—' },
              { label: 'Department', value: p.currentDepartment ?? '—' },
              { label: 'Role family', value: p.roleFamily ?? '—' },
              { label: 'Seniority', value: p.seniority ?? '—' },
              { label: 'Current org', value: p.currentOrganizationId ?? '—' },
              { label: 'Strength', value: p.relationshipStrength ?? '—' },
              { label: 'Last seen', value: p.lastInteractionAt?.slice(0, 10) ?? '—' },
              { label: 'Important dates', value: p.importantDatesJson ?? '—' },
              { label: 'Created', value: p.createdAt.slice(0, 10) },
              { label: 'Updated', value: p.updatedAt.slice(0, 10) },
              { label: 'Archived', value: p.archivedAt?.slice(0, 10) ?? '—' },
            ]}
          />
          {p.summary ? <p className="text-sm text-foreground">{p.summary}</p> : null}
          {p.notes ? <p className="whitespace-pre-wrap text-sm text-foreground">{p.notes}</p> : null}
          {links.data ? (
            <>
              <LinkedRecords title="Organizations" records={links.data.organizations} onUnlink={onUnlink} />
              <LinkedRecords title="Projects" records={links.data.projects} onUnlink={onUnlink} />
              <LinkedRecords title="Tasks" records={links.data.tasks} onUnlink={onUnlink} />
              <LinkedRecords title="Interactions" records={links.data.interactions} onUnlink={onUnlink} />
              <LinkedRecords title="Documents" records={links.data.documents} onUnlink={onUnlink} />
              <LinkedRecords title="Assets" records={links.data.assets} onUnlink={onUnlink} />
            </>
          ) : null}
          {memories.data ? (
            <MemoryList records={memories.data} recordType="person" recordId={id} />
          ) : null}
          <RecordInspectionPanel inspection={inspection.data} />
        </>
      )}
    </DetailPage>
  )
}
