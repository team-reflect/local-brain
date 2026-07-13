import { useState, type ReactNode } from 'react'
import { Archive, MoreHorizontal, Plus } from 'lucide-react'
import type { Task } from '@local-brain/core'
import { Alert } from '../components/alert'
import { StatusBadge } from '../components/badge'
import { Button } from '../components/button'
import { DataList, type Column } from '../components/data-list'
import { EmptyState } from '../components/empty-state'
import { PageHead } from '../components/page-head'
import { QueryError } from '../components/query-error'
import {
  TaskCompletionFeedback,
  TaskCompletionFeedbackProvider,
} from '../components/task-completion-feedback'
import { TaskCompletionControl } from '../components/task-completion-control'
import { TaskCreateDialog } from '../components/task-create-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { cn, errorMessage } from '../lib/utils'
import { useAllTaskAssignees, useArchiveTask, useTasks } from '../lib/queries'
import { useRouter } from '../routing/router'

const VIEWS = [
  { key: 'active', label: 'Active' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'done', label: 'Done' },
  { key: 'all', label: 'All' },
] as const

type TaskView = (typeof VIEWS)[number]['key']

export function TasksSurface(): ReactNode {
  const [view, setView] = useState<TaskView>('active')
  const [createOpen, setCreateOpen] = useState(false)
  const { navigate } = useRouter()
  const tasks = useTasks()
  const archive = useArchiveTask()
  const assigneesQuery = useAllTaskAssignees()
  const visibleTasks = (tasks.data ?? []).filter((task) => taskMatchesView(task, view))

  const columns: Column<Task>[] = [
    {
      key: 'done',
      header: '',
      className: 'w-9 pr-0',
      render: (task) => (
        <TaskCompletionControl id={task.id} title={task.title} status={task.status} />
      ),
    },
    {
      key: 'title',
      header: 'Task',
      render: (task) => (
        <span className={cn(task.status === 'done' && 'text-muted-foreground line-through')}>
          {task.title}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      className: 'w-28',
      render: (task) => <StatusBadge status={task.status} />,
    },
    {
      key: 'assignee',
      header: 'Assignee',
      className: 'w-32',
      render: (task) => {
        if (assigneesQuery.isPending && !assigneesQuery.data) {
          return <span className="text-muted-foreground" aria-label="Loading assignee">…</span>
        }
        if (assigneesQuery.isError && !assigneesQuery.data) {
          return <span className="text-muted-foreground">Unavailable</span>
        }
        const taskAssignees = assigneesQuery.data?.get(task.id) ?? []
        if (taskAssignees.length === 0) return <span className="text-muted-foreground">—</span>
        return (
          <span className="block max-w-32 truncate text-xs text-muted-foreground">
            {taskAssignees.map((assignee) => assignee.personName).join(', ')}
          </span>
        )
      },
    },
    {
      key: 'due',
      header: 'Due',
      className: 'w-28',
      render: (task) => (
        <span className="font-mono text-[11px] text-muted-foreground">
          {task.dueAt ? task.dueAt.slice(0, 10) : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-10 text-right',
      render: (task) => (
        <div onClick={(event) => event.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="size-7 px-0 opacity-60 hover:opacity-100"
                aria-label={`Actions for ${task.title}`}
              >
                <MoreHorizontal aria-hidden className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem variant="destructive" onSelect={() => archive.mutate(task.id)}>
                <Archive aria-hidden />
                Archive task
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ]

  return (
    <TaskCompletionFeedbackProvider>
      <div className="mx-auto flex h-full min-h-0 max-w-5xl flex-col gap-4">
        <PageHead
          eyebrow="Workspace"
          title="Tasks"
          actions={(
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden className="size-3.5" />
              New task
            </Button>
          )}
        />

        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            {tasks.data
              ? `${visibleTasks.length} ${visibleTasks.length === 1 ? 'task' : 'tasks'}`
              : tasks.isError
                ? 'Tasks unavailable'
                : 'Loading tasks'}
          </p>
          <div className="flex items-center gap-1" aria-label="Task views">
            {VIEWS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setView(option.key)}
                aria-pressed={view === option.key}
                className={cn(
                  'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                  view === option.key
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:bg-secondary/60',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {archive.isError ? (
          <Alert variant="error">Could not archive task: {errorMessage(archive.error)}</Alert>
        ) : null}
        {assigneesQuery.isError ? (
          <QueryError
            title="Could not load task assignees"
            error={assigneesQuery.error}
            onRetry={() => void assigneesQuery.refetch()}
          />
        ) : null}
        <TaskCompletionFeedback />

        <DataList
          rows={visibleTasks}
          columns={columns}
          rowKey={(task) => task.id}
          isLoading={tasks.isLoading}
          error={tasks.error}
          errorTitle="Could not load tasks"
          onRetry={() => void tasks.refetch()}
          onRowClick={(task) => navigate({ kind: 'task', id: task.id })}
          empty={(
            <EmptyState
              title={tasks.data?.length === 0 ? 'No tasks yet' : `No ${viewLabel(view).toLowerCase()} tasks`}
              hint={tasks.data?.length === 0 ? 'Create a task to start tracking the work.' : 'Try another view.'}
              action={tasks.data?.length === 0 ? (
                <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
                  <Plus aria-hidden className="size-3.5" />
                  New task
                </Button>
              ) : undefined}
            />
          )}
          className="flex-1"
        />

        <TaskCreateDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => navigate({ kind: 'task', id })}
        />
      </div>
    </TaskCompletionFeedbackProvider>
  )
}

function taskMatchesView(task: Task, view: TaskView): boolean {
  const terminal = task.status === 'done' || task.status === 'cancelled' || task.status === 'canceled'
  switch (view) {
    case 'active':
      return !terminal
    case 'scheduled':
      return !terminal && task.scheduledFor !== null
    case 'waiting':
      return task.status === 'waiting' || task.status === 'blocked'
    case 'done':
      return task.status === 'done'
    case 'all':
      return true
  }
}

function viewLabel(view: TaskView): string {
  return VIEWS.find((option) => option.key === view)?.label ?? view
}
