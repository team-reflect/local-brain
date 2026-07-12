import { sql, type RawBuilder } from 'kysely'
import { db } from '../../db/client'
import { OPEN_TASK_STATUSES } from '../../reports/getters'

/** Structured task filters and ordering used by Chat's task-list tool. */
export interface ChatTaskBrowseOptions {
  statuses?: readonly string[]
  projectId?: string
  personId?: string
  dueAfter?: string
  dueBefore?: string
  includeCompleted?: boolean
  sort?: 'due' | 'recently_updated'
  limit: number
}

/** Compact stable-reference task returned to Chat and its source UI. */
export interface ChatTaskCandidate {
  recordType: 'task'
  recordId: string
  recordRef: string
  title: string
  date: string
  status: string
  priority: number | null
  projectId: string | null
  dueAt: string | null
  scheduledFor: string | null
  completedAt: string | null
}

interface TaskRow {
  recordId: string
  title: string
  status: string
  priority: number | null
  projectId: string | null
  dueAt: string | null
  scheduledFor: string | null
  completedAt: string | null
  updatedAt: string
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function inclusiveBefore(value: string): string {
  return DATE_ONLY.test(value) ? `${value}T23:59:59.999Z` : value
}

/** Browse typed task fields without relying on chunk or embedding freshness. */
export async function listChatTasks(options: ChatTaskBrowseOptions): Promise<ChatTaskCandidate[]> {
  const dueDate = sql`COALESCE(tasks.due_at, tasks.scheduled_for)`
  const clauses: RawBuilder<unknown>[] = [sql`tasks.archived_at IS NULL`]
  if (options.statuses && options.statuses.length > 0) {
    clauses.push(sql`tasks.status IN (${sql.join(options.statuses.map((status) => sql`${status}`))})`)
  } else if (!options.includeCompleted) {
    clauses.push(sql`tasks.status IN (${sql.join(OPEN_TASK_STATUSES.map((status) => sql`${status}`))})`)
  }
  if (options.projectId) clauses.push(sql`tasks.project_id = ${options.projectId}`)
  if (options.personId) {
    clauses.push(sql`EXISTS (
      SELECT 1 FROM task_people
      WHERE task_people.task_id = tasks.id
        AND task_people.person_id = ${options.personId}
    )`)
  }
  if (options.dueAfter) clauses.push(sql`${dueDate} >= ${options.dueAfter}`)
  if (options.dueBefore) clauses.push(sql`${dueDate} <= ${inclusiveBefore(options.dueBefore)}`)

  const order =
    options.sort === 'recently_updated'
      ? sql`tasks.updated_at DESC, tasks.id ASC`
      : sql`${dueDate} IS NULL ASC, ${dueDate} ASC, tasks.priority DESC, tasks.id ASC`
  const rows = (
    await sql<TaskRow>`
      SELECT
        tasks.id AS "recordId",
        tasks.title AS "title",
        tasks.status AS "status",
        tasks.priority AS "priority",
        tasks.project_id AS "projectId",
        tasks.due_at AS "dueAt",
        tasks.scheduled_for AS "scheduledFor",
        tasks.completed_at AS "completedAt",
        tasks.updated_at AS "updatedAt"
      FROM tasks
      WHERE ${sql.join(clauses, sql` AND `)}
      ORDER BY ${order}
      LIMIT ${options.limit}
    `.execute(db)
  ).rows

  return rows.map((row) => ({
    recordType: 'task',
    recordId: row.recordId,
    recordRef: `task:${row.recordId}`,
    title: row.title,
    date: row.dueAt ?? row.scheduledFor ?? row.updatedAt,
    status: row.status,
    priority: row.priority,
    projectId: row.projectId,
    dueAt: row.dueAt,
    scheduledFor: row.scheduledFor,
    completedAt: row.completedAt,
  }))
}
