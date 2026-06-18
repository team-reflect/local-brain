import type { ReactNode } from 'react'
import { DetailFields } from '../../components/detail-fields'
import { EmptyState } from '../../components/empty-state'
import { LinkedRecords } from '../../components/linked-records'
import { PageHead } from '../../components/page-head'
import { useOrganization, useOrganizationLinks } from '../../lib/queries'

export function OrganizationDetail({ id }: { id: string }): ReactNode {
  const organization = useOrganization(id)
  const links = useOrganizationLinks(id)

  if (organization.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!organization.data) return <EmptyState title="Organization not found" />

  const o = organization.data
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <PageHead eyebrow="Organization" title={o.name} />
      <DetailFields
        fields={[
          { label: 'Kind', value: o.kind ?? '—' },
          { label: 'Domain', value: o.domain ?? '—' },
          { label: 'Location', value: o.location ?? '—' },
        ]}
      />
      {o.summary ? <p className="text-sm text-foreground">{o.summary}</p> : null}
      {links.data ? (
        <>
          <LinkedRecords title="People" records={links.data.people} />
          <LinkedRecords title="Projects" records={links.data.projects} />
          <LinkedRecords title="Documents" records={links.data.documents} />
          <LinkedRecords title="Interactions" records={links.data.interactions} />
          <LinkedRecords title="Tasks" records={links.data.tasks} />
        </>
      ) : null}
    </div>
  )
}
