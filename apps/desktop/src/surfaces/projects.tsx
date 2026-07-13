import { useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import type { Project } from '@local-brain/core'
import { StatusBadge } from '../components/badge'
import { Button } from '../components/button'
import { DataList, type Column } from '../components/data-list'
import { EmptyState } from '../components/empty-state'
import { PageHead } from '../components/page-head'
import { ProjectCreateDialog } from '../components/project-create-dialog'
import { useProjects } from '../lib/queries'
import { useRouter } from '../routing/router'

export function ProjectsSurface(): ReactNode {
  const { navigate } = useRouter()
  const projects = useProjects()
  const [createOpen, setCreateOpen] = useState(false)

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
    <div className="mx-auto flex h-full min-h-0 max-w-5xl flex-col gap-4">
      <PageHead
        eyebrow="Workspace"
        title="Projects"
        actions={(
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden className="size-3.5" />
            New project
          </Button>
        )}
      />
      <DataList
        rows={projects.data ?? []}
        columns={columns}
        rowKey={(project) => project.id}
        isLoading={projects.isLoading}
        error={projects.error}
        errorTitle="Could not load projects"
        onRetry={() => void projects.refetch()}
        onRowClick={(project) => navigate({ kind: 'project', id: project.id })}
        empty={(
          <EmptyState
            title="No projects yet"
            hint="Create a project to group related work and context."
            action={(
              <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus aria-hidden className="size-3.5" />
                New project
              </Button>
            )}
          />
        )}
      />
      <ProjectCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => navigate({ kind: 'project', id })}
      />
    </div>
  )
}
