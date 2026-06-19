import { db } from '../db/client'
import { nowIso } from '../db/time'
import type { Task } from '../domains/tasks/getters'

/**
 * Agent-facing retrieval endpoints (Plan 06, step 13). The daily brief, todo
 * list, "what changed", and waiting items are assembled here from durable typed
 * records so the Today surface, the `brain` CLI, and a daily automation all read
 * the same structured context — no per-caller queries, no separate report table.
 */

/** Non-terminal task statuses (everything still actionable). */
export const OPEN_TASK_STATUSES = ['open', 'in_progress', 'waiting', 'blocked'] as const
const TERMINAL = new Set(['done', 'cancelled', 'canceled'])

export interface BriefTask {
  id: string
  title: string
  status: string
  dueAt: string | null
  scheduledFor: string | null
  priority: number | null
  projectId: string | null
  /** `overdue` | `today` | `soon` | `scheduled` | `open` */
  bucket: TaskBucket
}

export type TaskBucket = 'overdue' | 'today' | 'soon' | 'scheduled' | 'open'

export interface BriefInteraction {
  id: string
  title: string | null
  kind: string
  occurredAt: string | null
}

export interface DailyBrief {
  generatedAt: string
  date: string
  tasks: {
    overdue: BriefTask[]
    today: BriefTask[]
    soon: BriefTask[]
    open: BriefTask[]
  }
  recentInteractions: BriefInteraction[]
  counts: {
    openTasks: number
    overdueTasks: number
    dueToday: number
  }
}

export interface DailyBriefOptions {
  now?: Date
  /** Window (days) for the "soon" bucket. */
  soonDays?: number
  /** How many recent interactions to include. */
  recentLimit?: number
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function bucketFor(task: { dueAt: string | null; scheduledFor: string | null }, now: Date, soonDays: number): TaskBucket {
  const today = dayKey(now)
  if (task.dueAt) {
    const due = task.dueAt.slice(0, 10)
    if (due < today) return 'overdue'
    if (due === today) return 'today'
    const soonCutoff = dayKey(new Date(now.getTime() + soonDays * 86_400_000))
    if (due <= soonCutoff) return 'soon'
  }
  if (task.scheduledFor) {
    const sched = task.scheduledFor.slice(0, 10)
    if (sched <= today) return 'today'
    return 'scheduled'
  }
  return 'open'
}

function toBriefTask(task: Task, bucket: TaskBucket): BriefTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    dueAt: task.dueAt,
    scheduledFor: task.scheduledFor,
    priority: task.priority,
    projectId: task.projectId,
    bucket,
  }
}

/** Assemble the daily brief: bucketed open tasks and recent interactions. */
export async function getDailyBrief(options: DailyBriefOptions = {}): Promise<DailyBrief> {
  const now = options.now ?? new Date()
  const soonDays = options.soonDays ?? 7
  const recentLimit = options.recentLimit ?? 5

  const [openTasks, interactions] = await Promise.all([
    db
      .selectFrom('tasks')
      .selectAll()
      .where('archivedAt', 'is', null)
      .where('status', 'in', [...OPEN_TASK_STATUSES])
      .orderBy('dueAt', 'asc')
      .execute(),
    db
      .selectFrom('interactions')
      .select(['id', 'title', 'kind', 'occurredAt'])
      .where('archivedAt', 'is', null)
      .orderBy('occurredAt', 'desc')
      .limit(recentLimit)
      .execute(),
  ])

  const overdue: BriefTask[] = []
  const today: BriefTask[] = []
  const soon: BriefTask[] = []
  const open: BriefTask[] = []
  for (const task of openTasks) {
    if (TERMINAL.has(task.status)) continue
    const bucket = bucketFor(task, now, soonDays)
    const brief = toBriefTask(task, bucket)
    if (bucket === 'overdue') overdue.push(brief)
    else if (bucket === 'today') today.push(brief)
    else if (bucket === 'soon') soon.push(brief)
    else open.push(brief)
  }

  return {
    generatedAt: now.toISOString(),
    date: dayKey(now),
    tasks: { overdue, today, soon, open },
    recentInteractions: interactions.map((i) => ({
      id: i.id,
      title: i.title,
      kind: i.kind,
      occurredAt: i.occurredAt,
    })),
    counts: {
      openTasks: openTasks.length,
      overdueTasks: overdue.length,
      dueToday: today.length,
    },
  }
}

export interface PlanDayOptions {
  now?: Date
  limit?: number
}

/**
 * A prioritized todo list for "plan my day": overdue first, then due today, then
 * scheduled/soon, then the rest — each group ordered by priority then due date.
 */
export async function planDay(options: PlanDayOptions = {}): Promise<BriefTask[]> {
  const now = options.now ?? new Date()
  const limit = options.limit ?? 25
  const brief = await getDailyBrief({ now })
  const ordered = [...brief.tasks.overdue, ...brief.tasks.today, ...brief.tasks.soon, ...brief.tasks.open]
  const byPriority = (a: BriefTask, b: BriefTask): number => {
    const pa = a.priority ?? 99
    const pb = b.priority ?? 99
    if (pa !== pb) return pa - pb
    return (a.dueAt ?? '~').localeCompare(b.dueAt ?? '~')
  }
  // Stable within-bucket priority sort, preserving the bucket order above.
  const buckets: BriefTask[][] = [[], [], [], []]
  const bucketIndex: Record<TaskBucket, number> = { overdue: 0, today: 1, soon: 2, scheduled: 2, open: 3 }
  for (const task of ordered) {
    const group = buckets[bucketIndex[task.bucket]]
    if (group) group.push(task)
  }
  return buckets.flatMap((group) => group.sort(byPriority)).slice(0, limit)
}

/** Tasks blocked on someone/something else. */
export function getWaitingItems(): Promise<Task[]> {
  return db
    .selectFrom('tasks')
    .selectAll()
    .where('archivedAt', 'is', null)
    .where('status', 'in', ['waiting', 'blocked'])
    .orderBy('updatedAt', 'desc')
    .execute()
}

export interface ChangedRecord {
  kind: 'person' | 'organization' | 'project' | 'task' | 'document' | 'interaction'
  id: string
  title: string
  updatedAt: string
}

/** Records created or updated since an ISO timestamp, newest first. */
export async function getChangesSince(sinceIso: string, limit = 50): Promise<ChangedRecord[]> {
  const since = sinceIso || nowIso()
  const [people, organizations, projects, tasks, documents, interactions] = await Promise.all([
    db.selectFrom('people').select(['id', 'fullName as title', 'updatedAt']).where('updatedAt', '>=', since).execute(),
    db.selectFrom('organizations').select(['id', 'name as title', 'updatedAt']).where('updatedAt', '>=', since).execute(),
    db.selectFrom('projects').select(['id', 'name as title', 'updatedAt']).where('updatedAt', '>=', since).execute(),
    db.selectFrom('tasks').select(['id', 'title', 'updatedAt']).where('updatedAt', '>=', since).execute(),
    db.selectFrom('documents').select(['id', 'title', 'updatedAt']).where('updatedAt', '>=', since).execute(),
    db.selectFrom('interactions').select(['id', 'title', 'updatedAt']).where('updatedAt', '>=', since).execute(),
  ])
  const tag = (kind: ChangedRecord['kind'], rows: { id: string; title: string | null; updatedAt: string }[]) =>
    rows.map((r) => ({ kind, id: r.id, title: r.title ?? '(untitled)', updatedAt: r.updatedAt }))
  return [
    ...tag('person', people),
    ...tag('organization', organizations),
    ...tag('project', projects),
    ...tag('task', tasks),
    ...tag('document', documents),
    ...tag('interaction', interactions),
  ]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
}
