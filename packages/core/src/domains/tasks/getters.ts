import type { Selectable } from 'kysely'
import type { Tasks } from '@local-brain/db'
import { db } from '../../db/client'

export type Task = Selectable<Tasks>

/** The `task_people.role` value that marks a person as the task's assignee. */
export const TASK_PERSON_ROLE_ASSIGNEE = 'assignee'

export interface TaskAssignee {
  taskId: string
  personId: string
  personName: string
}

export interface ListTasksOptions {
  status?: string
  projectId?: string
  includeArchived?: boolean
  limit?: number
}

/** Tasks ordered by due date (nulls last), optionally scoped by status/project. */
export function listTasks(options: ListTasksOptions = {}): Promise<Task[]> {
  let query = db.selectFrom('tasks').selectAll()
  if (!options.includeArchived) {
    query = query.where('archivedAt', 'is', null)
  }
  if (options.status !== undefined) {
    query = query.where('status', '=', options.status)
  }
  if (options.projectId !== undefined) {
    query = query.where('projectId', '=', options.projectId)
  }
  query = query.orderBy('dueAt', 'asc')
  if (options.limit !== undefined) {
    query = query.limit(options.limit)
  }
  return query.execute()
}

export function getTask(id: string): Promise<Task | undefined> {
  return db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirst()
}

/** Assignees (role='assignee') for a single task, ordered by name. */
export function listTaskAssignees(taskId: string): Promise<TaskAssignee[]> {
  return db
    .selectFrom('taskPeople')
    .innerJoin('people', 'people.id', 'taskPeople.personId')
    .where('taskPeople.taskId', '=', taskId)
    .where('taskPeople.role', '=', TASK_PERSON_ROLE_ASSIGNEE)
    .where('people.archivedAt', 'is', null)
    .orderBy('people.fullName', 'asc')
    .select(['taskPeople.taskId', 'taskPeople.personId', 'people.fullName as personName'])
    .execute()
}

/** All task assignees across every task (role='assignee'), for bulk UI rendering. */
export function listAllTaskAssignees(): Promise<TaskAssignee[]> {
  return db
    .selectFrom('taskPeople')
    .innerJoin('people', 'people.id', 'taskPeople.personId')
    .where('taskPeople.role', '=', TASK_PERSON_ROLE_ASSIGNEE)
    .where('people.archivedAt', 'is', null)
    .orderBy('people.fullName', 'asc')
    .select(['taskPeople.taskId', 'taskPeople.personId', 'people.fullName as personName'])
    .execute()
}
