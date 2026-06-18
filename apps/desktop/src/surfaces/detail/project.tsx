import type { ReactNode } from 'react'
import { StatusBadge } from '../../components/badge'
import { DetailFields } from '../../components/detail-fields'
import { DetailPage } from '../../components/detail-page'
import { LinkedRecords } from '../../components/linked-records'
import { PageHead } from '../../components/page-head'
import { useProject, useProjectLinks, useUnlinkFrom } from '../../lib/queries'

export function ProjectDetail({ id }: { id: string }): ReactNode {
  const project = useProject(id)
  const links = useProjectLinks(id)
  const onUnlink = useUnlinkFrom({ kind: 'project', id })

  return (
    <DetailPage query={project} notFoundTitle="Project not found">
      {(p) => (
        <>
          <PageHead eyebrow="Project" title={p.name} />
          <DetailFields
            fields={[
              { label: 'Status', value: <StatusBadge status={p.status} /> },
              { label: 'Kind', value: p.kind ?? '—' },
              { label: 'Started', value: p.startedOn ?? '—' },
              { label: 'Target', value: p.targetDate ?? '—' },
              { label: 'Completed', value: p.completedOn ?? '—' },
            ]}
          />
          {p.summary ? <p className="text-sm text-foreground">{p.summary}</p> : null}
          {links.data ? (
            <>
              <LinkedRecords title="Tasks" records={links.data.tasks} onUnlink={onUnlink} />
              <LinkedRecords title="People" records={links.data.people} onUnlink={onUnlink} />
              <LinkedRecords title="Organizations" records={links.data.organizations} onUnlink={onUnlink} />
              <LinkedRecords title="Documents" records={links.data.documents} onUnlink={onUnlink} />
              <LinkedRecords title="Interactions" records={links.data.interactions} onUnlink={onUnlink} />
            </>
          ) : null}
        </>
      )}
    </DetailPage>
  )
}
