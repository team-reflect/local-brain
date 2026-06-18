import type { ReactNode } from 'react'
import { DetailFields } from '../../components/detail-fields'
import { EmptyState } from '../../components/empty-state'
import { LinkedRecords } from '../../components/linked-records'
import { PageHead } from '../../components/page-head'
import { useProject, useProjectLinks, useUnlinkFrom } from '../../lib/queries'

export function ProjectDetail({ id }: { id: string }): ReactNode {
  const project = useProject(id)
  const links = useProjectLinks(id)
  const onUnlink = useUnlinkFrom({ kind: 'project', id })

  if (project.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!project.data) return <EmptyState title="Project not found" />

  const p = project.data
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <PageHead eyebrow="Project" title={p.name} />
      <DetailFields
        fields={[
          { label: 'Status', value: p.status },
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
    </div>
  )
}
