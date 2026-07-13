import { describe, expect, it } from 'vitest'
import type { Task } from '@local-brain/core'
import { groupTodayTasks } from './today-task-groups'

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: null,
    status: 'open',
    priority: null,
    projectId: null,
    dueAt: null,
    scheduledFor: null,
    completedAt: null,
    originDocumentId: null,
    originInteractionId: null,
    sourceRecordType: null,
    sourceRecordId: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    archivedAt: null,
    ...patch,
  }
}

describe('groupTodayTasks', () => {
  it('assigns each actionable task to one operational bucket', () => {
    const groups = groupTodayTasks([
      task('overdue', { dueAt: '2026-07-12' }),
      task('today', { dueAt: '2026-07-13', scheduledFor: '2026-07-14' }),
      task('scheduled-later', { scheduledFor: '2026-07-16' }),
      task('scheduled-sooner', { scheduledFor: '2026-07-14' }),
      task('waiting', { status: 'waiting', dueAt: '2026-07-12' }),
      task('blocked', { status: 'blocked' }),
      task('open'),
      task('done', { status: 'done' }),
      task('cancelled', { status: 'cancelled' }),
    ], '2026-07-13')

    expect(groups.due.map((item) => item.id)).toEqual(['overdue', 'today'])
    expect(groups.scheduled.map((item) => item.id)).toEqual(['scheduled-sooner', 'scheduled-later'])
    expect(groups.waiting.map((item) => item.id)).toEqual(['waiting', 'blocked'])
    expect(groups.open.map((item) => item.id)).toEqual(['open'])
  })
})
