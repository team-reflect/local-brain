import type { ReactNode } from 'react'
import { DetailFields } from '../../components/detail-fields'
import { DetailPage } from '../../components/detail-page'
import { LinkedRecords } from '../../components/linked-records'
import { MemoryList } from '../../components/memory-list'
import { PageHead } from '../../components/page-head'
import {
  DetailLink,
  DetailNote,
  ImportantDatesSection,
  PersonAffiliationsSection,
  PersonContactSection,
  SourceTrailSection,
} from '../../components/record-detail-sections'
import {
  useExternalIdentities,
  useMemoriesForRecord,
  usePerson,
  usePersonAffiliations,
  usePersonEmails,
  usePersonLinks,
  usePersonPhones,
  useRecordProvenance,
  useUnlinkFrom,
} from '../../lib/queries'

function fullLocation({
  location,
  city,
  region,
  country,
}: {
  location: string | null
  city: string | null
  region: string | null
  country: string | null
}): string | null {
  const structured = [city, region, country].filter(Boolean).join(', ')
  return location ?? (structured || null)
}

export function PersonDetail({ id }: { id: string }): ReactNode {
  const person = usePerson(id)
  const links = usePersonLinks(id)
  const emails = usePersonEmails(id)
  const phones = usePersonPhones(id)
  const affiliations = usePersonAffiliations(id)
  const memories = useMemoriesForRecord('person', id)
  const identities = useExternalIdentities('person', id)
  const provenance = useRecordProvenance('person', id)
  const onUnlink = useUnlinkFrom({ kind: 'person', id })

  return (
    <DetailPage query={person} notFoundTitle="Person not found">
      {(p) => {
        const currentAffiliation = affiliations.data?.find((affiliation) => affiliation.isCurrent)
        const currentOrganization = currentAffiliation?.organizationName
        const currentRole =
          [p.currentTitle ?? currentAffiliation?.title, currentOrganization].filter(Boolean).join(' at ') || null
        return (
          <>
            <PageHead eyebrow={p.isSelf ? 'You' : 'Person'} title={p.fullName} />
            <DetailFields
              fields={[
                { label: 'Preferred name', value: p.preferredName ?? '—' },
                { label: 'Headline', value: p.headline ?? '—' },
                { label: 'Current role', value: currentRole ?? '—' },
                { label: 'Department', value: p.currentDepartment ?? '—' },
                { label: 'Role family', value: p.roleFamily ?? '—' },
                { label: 'Seniority', value: p.seniority ?? '—' },
                { label: 'Email', value: p.primaryEmail ?? '—' },
                { label: 'Phone', value: p.primaryPhone ?? '—' },
                { label: 'Location', value: fullLocation(p) ?? '—' },
                { label: 'Timezone', value: p.timezone ?? '—' },
                { label: 'LinkedIn', value: <DetailLink href={p.linkedinUrl} /> },
                { label: 'Website', value: <DetailLink href={p.website} /> },
                { label: 'Strength', value: p.relationshipStrength ?? '—' },
                { label: 'Last seen', value: p.lastInteractionAt?.slice(0, 10) ?? '—' },
                { label: 'Created', value: p.createdAt.slice(0, 10) },
                { label: 'Updated', value: p.updatedAt.slice(0, 10) },
                { label: 'Archived', value: p.archivedAt?.slice(0, 10) ?? '—' },
              ]}
            />
            {p.summary ? <p className="text-sm leading-5 text-foreground">{p.summary}</p> : null}
            <PersonContactSection emails={emails.data} phones={phones.data} />
            <PersonAffiliationsSection affiliations={affiliations.data} />
            <ImportantDatesSection value={p.importantDatesJson} />
            <DetailNote title="Notes">{p.notes}</DetailNote>
            {links.data ? (
              <>
                <LinkedRecords title="Organizations" records={links.data.organizations} onUnlink={onUnlink} />
                <LinkedRecords title="Projects" records={links.data.projects} onUnlink={onUnlink} />
                <LinkedRecords title="Tasks" records={links.data.tasks} onUnlink={onUnlink} />
                <LinkedRecords title="Interactions" records={links.data.interactions} onUnlink={onUnlink} />
                <LinkedRecords title="Documents" records={links.data.documents} onUnlink={onUnlink} />
              </>
            ) : null}
            {memories.data ? (
              <MemoryList records={memories.data} recordType="person" recordId={id} />
            ) : null}
            <SourceTrailSection identities={identities.data} provenance={provenance.data} />
          </>
        )
      }}
    </DetailPage>
  )
}
