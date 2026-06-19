import type { ReactNode } from 'react'
import type { Project } from '@local-brain/core'
import { StatusBadge } from '../components/badge'
import { DataList, type Column } from '../components/data-list'
import { EmptyState } from '../components/empty-state'
import { useProjects } from '../lib/queries'
import { useRouter } from '../routing/router'

export function ProjectsSurface(): ReactNode {
  const { navigate } = useRouter()
  const projects = useProjects()

  const columns: Column<Project>[] = [
    {
      key: 'name',
      header: 'Project',
      render: (project) => <span className="text-foreground">{project.name}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      className: 'w-28',
      render: (project) => <StatusBadge status={project.status} />,
    },
    {
      key: 'target',
      header: 'Target',
      className: 'w-28',
      render: (project) => (
        <span className="font-mono text-[11px] text-muted-foreground">
          {project.targetDate ?? '—'}
        </span>
      ),
    },
  ]

  return (
    <div className="mx-auto flex h-full min-h-0 max-w-4xl flex-col gap-4">
      <DataList
        rows={projects.data ?? []}
        columns={columns}
        rowKey={(project) => project.id}
        isLoading={projects.isLoading}
        onRowClick={(project) => navigate({ kind: 'project', id: project.id })}
        empty={<EmptyState title="No projects yet" />}
      />
    </div>
  )
}
