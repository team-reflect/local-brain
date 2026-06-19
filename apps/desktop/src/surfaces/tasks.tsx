import { useState, type ReactNode } from 'react'
import type { Task } from '@local-brain/core'
import { StatusBadge } from '../components/badge'
import { Checkbox } from '../components/ui/checkbox'
import { DataList, type Column } from '../components/data-list'
import { EmptyState } from '../components/empty-state'
import { cn } from '../lib/utils'
import { useAllTaskAssignees, useArchiveTask, useCompleteTask, useTasks } from '../lib/queries'
import { useRouter } from '../routing/router'

const FILTERS = ['all', 'open', 'waiting', 'scheduled', 'done'] as const

export function TasksSurface(): ReactNode {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('open')
  const { navigate } = useRouter()
  const tasks = useTasks(filter === 'all' ? {} : { status: filter })
  const complete = useCompleteTask()
  const archive = useArchiveTask()
  const assigneesQuery = useAllTaskAssignees()

  const columns: Column<Task>[] = [
    {
      key: 'done',
      header: '',
      className: 'w-8',
      render: (task) => (
        <Checkbox
          checked={task.status === 'done'}
          onClick={(event) => event.stopPropagation()}
          onCheckedChange={() => complete.mutate(task.id)}
          aria-label={`Complete ${task.title}`}
        />
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
        const taskAssignees = assigneesQuery.data?.get(task.id) ?? []
        if (taskAssignees.length === 0) return <span className="text-muted-foreground">—</span>
        return (
          <span className="truncate text-xs text-muted-foreground">
            {taskAssignees.map((a) => a.personName).join(', ')}
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
      key: 'archive',
      header: '',
      className: 'w-10 text-right',
      render: (task) => (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            archive.mutate(task.id)
          }}
          aria-label={`Archive ${task.title}`}
          className="text-muted-foreground hover:text-destructive"
        >
          ×
        </button>
      ),
    },
  ]

  return (
    <div className="mx-auto flex h-full min-h-0 max-w-4xl flex-col gap-4">
      <div className="flex justify-end">
        <div className="flex items-center gap-1">
          {FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              className={cn(
                'rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors',
                filter === option
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/60',
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <DataList
        rows={tasks.data ?? []}
        columns={columns}
        rowKey={(task) => task.id}
        isLoading={tasks.isLoading}
        onRowClick={(task) => navigate({ kind: 'task', id: task.id })}
        empty={<EmptyState title="No tasks in this view" />}
        className="flex-1"
      />
    </div>
  )
}
