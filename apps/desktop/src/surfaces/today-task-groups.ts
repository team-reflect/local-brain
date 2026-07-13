import type { Task } from '@local-brain/core'

export interface TodayTaskGroups {
  due: Task[]
  scheduled: Task[]
  waiting: Task[]
  open: Task[]
}

/** Group each actionable task once for the structured Today agenda. */
export function groupTodayTasks(tasks: readonly Task[], today: string): TodayTaskGroups {
  const groups: TodayTaskGroups = { due: [], scheduled: [], waiting: [], open: [] }

  for (const task of tasks) {
    if (task.status === 'done' || task.status === 'cancelled' || task.status === 'canceled') continue
    if (task.status === 'waiting' || task.status === 'blocked') {
      groups.waiting.push(task)
      continue
    }
    if (task.dueAt && task.dueAt.slice(0, 10) <= today) {
      groups.due.push(task)
      continue
    }
    if (task.scheduledFor) {
      groups.scheduled.push(task)
      continue
    }
    groups.open.push(task)
  }

  groups.scheduled.sort((a, b) => compareNullableDates(a.scheduledFor, b.scheduledFor))
  return groups
}

function compareNullableDates(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a.localeCompare(b)
}
