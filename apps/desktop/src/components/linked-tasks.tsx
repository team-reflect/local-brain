import type { ReactNode } from 'react'
import type { LinkedRecord, LinkedTask } from '@local-brain/core'
import { Section } from './section'
import { TaskList } from './task-list'

interface LinkedTasksProps {
  title?: string
  tasks: readonly LinkedTask[]
  onUnlink?: (record: LinkedRecord) => void
  onOpenTask?: (task: LinkedTask) => void
}

/** An actionable linked-task section used on record detail pages. */
export function LinkedTasks({
  title = 'Tasks',
  tasks,
  onUnlink,
  onOpenTask,
}: LinkedTasksProps): ReactNode {
  if (tasks.length === 0) return null

  return (
    <Section title={title}>
      <TaskList
        tasks={tasks}
        {...(onOpenTask ? { onOpen: onOpenTask } : {})}
        {...(onUnlink ? { onUnlink } : {})}
      />
    </Section>
  )
}
