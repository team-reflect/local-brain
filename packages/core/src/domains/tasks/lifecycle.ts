/** Every supported durable task lifecycle status, in user-facing progression order. */
export const TASK_STATUSES = [
  'open',
  'in_progress',
  'waiting',
  'blocked',
  'done',
  'cancelled',
] as const

/** A canonical durable task lifecycle status. */
export type TaskStatus = (typeof TASK_STATUSES)[number]

/** Task statuses that still represent actionable work. */
export const OPEN_TASK_STATUSES = ['open', 'in_progress', 'waiting', 'blocked'] as const satisfies readonly TaskStatus[]

/** Task statuses that no longer represent actionable work. */
export const TERMINAL_TASK_STATUSES = ['done', 'cancelled'] as const satisfies readonly TaskStatus[]

const TASK_STATUS_SET: ReadonlySet<string> = new Set(TASK_STATUSES)

/** Return whether an external string is a canonical task lifecycle status. */
export function isTaskStatus(value: string): value is TaskStatus {
  return TASK_STATUS_SET.has(value)
}
