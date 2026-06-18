import type { ReactNode } from 'react'
import { DetailFields } from '../../components/detail-fields'
import { EmptyState } from '../../components/empty-state'
import { PageHead } from '../../components/page-head'
import { useProject } from '../../lib/queries'

export function ProjectDetail({ id }: { id: string }): ReactNode {
  const project = useProject(id)

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
    </div>
  )
}
