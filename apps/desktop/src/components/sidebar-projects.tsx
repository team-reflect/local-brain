import { useState, type ReactNode } from 'react'
import { ChevronDown, FolderKanban, Plus } from 'lucide-react'
import type { Project } from '@local-brain/core'
import { useProjects } from '../lib/queries'
import { cn } from '../lib/utils'
import type { Route } from '../routing/route'
import { useRouter } from '../routing/router'
import { ProjectCreateDialog } from './project-create-dialog'

interface SidebarProjectsProps {
  activeSection: string
  route: Route
}

export function SidebarProjects({ activeSection, route }: SidebarProjectsProps): ReactNode {
  const { navigate } = useRouter()
  const projects = useProjects()
  const [open, setOpen] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const active = activeSection === 'projects'

  function openProject(project: Project): void {
    navigate({ kind: 'project', id: project.id })
  }

  return (
    <section aria-label="Projects" className="flex flex-col gap-1">
      <div
        className={cn(
          'flex items-center gap-1 rounded-md transition-colors',
          active ? 'bg-secondary text-foreground' : 'text-[hsl(var(--lb-ink-2))] hover:bg-secondary/60',
        )}
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-medium"
        >
          <FolderKanban className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
          <span className="min-w-0 flex-1 truncate">Projects</span>
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              open ? 'rotate-0' : '-rotate-90',
            )}
          />
        </button>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          aria-label="Create project"
          title="Create project"
          className="mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      {open ? (
        <div className="ml-4 flex flex-col gap-0.5 border-l border-border/80 pl-2">
          {projects.isLoading ? (
            <div className="px-2.5 py-1.5 text-xs text-muted-foreground">Loading projects</div>
          ) : null}
          {projects.data?.map((project) => {
            const projectActive = route.kind === 'project' && route.id === project.id
            return (
              <button
                key={project.id}
                type="button"
                onClick={() => openProject(project)}
                aria-current={projectActive ? 'page' : undefined}
                className={cn(
                  'flex h-7 min-w-0 items-center rounded-md px-2.5 text-left text-xs transition-colors',
                  projectActive
                    ? 'bg-secondary text-foreground'
                    : 'text-[hsl(var(--lb-ink-2))] hover:bg-secondary/60 hover:text-foreground',
                )}
              >
                <span className="truncate">{project.name}</span>
              </button>
            )
          })}
          {!projects.isLoading && projects.data?.length === 0 ? (
            <div className="px-2.5 py-1.5 text-xs text-muted-foreground">No projects yet</div>
          ) : null}
        </div>
      ) : null}

      <ProjectCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => navigate({ kind: 'project', id })}
      />
    </section>
  )
}
