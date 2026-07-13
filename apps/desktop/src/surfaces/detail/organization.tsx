import type { ReactNode } from 'react'
import { DetailFields } from '../../components/detail-fields'
import { DetailPage } from '../../components/detail-page'
import { LinkedRecords } from '../../components/linked-records'
import { LinkedTasks } from '../../components/linked-tasks'
import { PageHead } from '../../components/page-head'
import {
  DetailLink,
  DetailNote,
  OrganizationProfilesSection,
  SourceTrailSection,
} from '../../components/record-detail-sections'
import {
  useExternalIdentities,
  useOrganization,
  useOrganizationLinks,
  useOrganizationProfiles,
  useRecordProvenance,
  useUnlinkFrom,
} from '../../lib/queries'

function fullHeadquarters({
  hqCity,
  hqRegion,
  hqCountry,
}: {
  hqCity: string | null
  hqRegion: string | null
  hqCountry: string | null
}): string | null {
  const value = [hqCity, hqRegion, hqCountry].filter(Boolean).join(', ')
  return value || null
}

export function OrganizationDetail({ id }: { id: string }): ReactNode {
  const organization = useOrganization(id)
  const links = useOrganizationLinks(id)
  const profiles = useOrganizationProfiles(id)
  const identities = useExternalIdentities('organization', id)
  const provenance = useRecordProvenance('organization', id)
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
              { label: 'Website', value: <DetailLink href={o.website} /> },
              { label: 'Industry', value: o.industry ?? '—' },
              { label: 'Location', value: o.location ?? '—' },
              { label: 'Headquarters', value: fullHeadquarters(o) ?? '—' },
              { label: 'Created', value: o.createdAt.slice(0, 10) },
              { label: 'Updated', value: o.updatedAt.slice(0, 10) },
              { label: 'Archived', value: o.archivedAt?.slice(0, 10) ?? '—' },
            ]}
          />
          {o.headline ? <p className="text-sm leading-5 text-foreground">{o.headline}</p> : null}
          {o.summary ? <p className="text-sm leading-5 text-foreground">{o.summary}</p> : null}
          <DetailNote title="Notes">{o.notes}</DetailNote>
          <OrganizationProfilesSection profiles={profiles.data} />
          {links.data ? (
            <>
              <LinkedRecords title="People" records={links.data.people} onUnlink={onUnlink} />
              <LinkedRecords title="Projects" records={links.data.projects} onUnlink={onUnlink} />
              <LinkedRecords title="Documents" records={links.data.documents} onUnlink={onUnlink} />
              <LinkedRecords title="Interactions" records={links.data.interactions} onUnlink={onUnlink} />
              <LinkedTasks tasks={links.data.tasks} onUnlink={onUnlink} />
            </>
          ) : null}
          <SourceTrailSection identities={identities.data} provenance={provenance.data} />
        </>
      )}
    </DetailPage>
  )
}
