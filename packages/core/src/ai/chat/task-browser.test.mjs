import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@local-brain/core'
import { freshDatabase, installSqliteBridge } from '../../db/sqlite-harness.mjs'
import { listChatTasks } from './task-browser.ts'

describe('listChatTasks', () => {
  beforeEach(() => installSqliteBridge(freshDatabase()))

  it('browses active tasks by due date and relationship', async () => {
    await db.insertInto('people').values({ id: 'person-1', fullName: 'Maya' }).execute()
    await db
      .insertInto('tasks')
      .values([
        { id: 'task-later', title: 'Later', status: 'open', dueAt: '2026-07-20T10:00:00.000Z' },
        { id: 'task-sooner', title: 'Sooner', status: 'waiting', dueAt: '2026-07-15T10:00:00.000Z' },
        { id: 'task-done', title: 'Done', status: 'done', dueAt: '2026-07-14T10:00:00.000Z' },
      ])
      .execute()
    await db
      .insertInto('taskPeople')
      .values({ id: 'task-person-1', taskId: 'task-sooner', personId: 'person-1' })
      .execute()

    const tasks = await listChatTasks({
      personId: 'person-1',
      dueAfter: '2026-07-01',
      dueBefore: '2026-07-31',
      limit: 20,
    })

    expect(tasks).toEqual([
      expect.objectContaining({
        recordId: 'task-sooner',
        recordRef: 'task:task-sooner',
        status: 'waiting',
      }),
    ])
  })

  it('includes terminal statuses only when explicitly requested', async () => {
    await db
      .insertInto('tasks')
      .values([
        { id: 'task-open', title: 'Open', status: 'open' },
        { id: 'task-done', title: 'Done', status: 'done' },
      ])
      .execute()

    await expect(listChatTasks({ limit: 20 })).resolves.toHaveLength(1)
    await expect(listChatTasks({ statuses: ['done'], limit: 20 })).resolves.toEqual([
      expect.objectContaining({ recordId: 'task-done', status: 'done' }),
    ])
  })
})
