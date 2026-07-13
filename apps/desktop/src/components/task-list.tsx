import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { localDateString } from '@local-brain/core'
import { useRouter } from '../routing/router'
import { cn } from '../lib/utils'
import { StatusBadge } from './badge'
import { TaskCompletionControl } from './task-completion-control'

export interface TaskListItem {
  id: string
  title: string
  status: string
  dueAt?: string | null
  scheduledFor?: string | null
}

interface TaskListProps<T extends TaskListItem> {
  tasks: readonly T[]
  onOpen?: (task: T) => void
  onUnlink?: (task: T) => void
}

/** Compact actionable task rows shared by Today and linked-record sections. */
export function TaskList<T extends TaskListItem>({
  tasks,
  onOpen,
  onUnlink,
}: TaskListProps<T>): ReactNode {
  const { navigate } = useRouter()

  return (
    <ul className="flex flex-col gap-0.5">
      {tasks.map((task) => {
        const completed = task.status === 'done'
        return (
          <li
            key={task.id}
            className="group flex min-h-8 items-center gap-2 rounded-md px-2.5 transition-colors hover:bg-secondary/60"
          >
            <TaskCompletionControl id={task.id} title={task.title} status={task.status} />
            <button
              type="button"
              onClick={() => {
                if (onOpen) {
                  onOpen(task)
                  return
                }
                navigate({ kind: 'task', id: task.id })
              }}
              className="flex min-w-0 flex-1 items-center justify-between gap-3 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <span className={cn('truncate text-foreground', completed && 'text-muted-foreground line-through')}>
                {task.title}
              </span>
              <TaskMetadata task={task} />
            </button>
            {onUnlink ? (
              <button
                type="button"
                onClick={() => onUnlink(task)}
                aria-label={`Unlink ${task.title}`}
                title="Unlink"
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors hover:text-destructive focus:opacity-100 group-hover:opacity-100"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function TaskMetadata({ task }: { task: TaskListItem }): ReactNode {
  const dueDate = task.dueAt?.slice(0, 10) ?? null
  const scheduledDate = task.scheduledFor?.slice(0, 10) ?? null
  const overdue = dueDate !== null && dueDate < localDateString() && task.status !== 'done'

  return (
    <span className="flex shrink-0 items-center gap-2">
      {dueDate ? (
        <span className={cn('font-mono text-[11px] text-muted-foreground', overdue && 'text-destructive')}>
          {overdue ? 'Overdue ' : 'Due '}{dueDate}
        </span>
      ) : scheduledDate ? (
        <span className="font-mono text-[11px] text-muted-foreground">Scheduled {scheduledDate}</span>
      ) : null}
      {task.status !== 'open' ? <StatusBadge status={task.status} /> : null}
    </span>
  )
}
