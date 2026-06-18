import type { ReactNode } from 'react'
import { DetailFields } from '../../components/detail-fields'
import { DetailPage } from '../../components/detail-page'
import { LinkedRecords } from '../../components/linked-records'
import { PageHead } from '../../components/page-head'
import { useOrganization, useOrganizationLinks, useUnlinkFrom } from '../../lib/queries'

export function OrganizationDetail({ id }: { id: string }): ReactNode {
  const organization = useOrganization(id)
  const links = useOrganizationLinks(id)
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
              { label: 'Location', value: o.location ?? '—' },
            ]}
          />
          {o.summary ? <p className="text-sm text-foreground">{o.summary}</p> : null}
          {links.data ? (
            <>
              <LinkedRecords title="People" records={links.data.people} onUnlink={onUnlink} />
              <LinkedRecords title="Projects" records={links.data.projects} onUnlink={onUnlink} />
              <LinkedRecords title="Documents" records={links.data.documents} onUnlink={onUnlink} />
              <LinkedRecords title="Interactions" records={links.data.interactions} onUnlink={onUnlink} />
              <LinkedRecords title="Tasks" records={links.data.tasks} onUnlink={onUnlink} />
            </>
          ) : null}
        </>
      )}
    </DetailPage>
  )
}
