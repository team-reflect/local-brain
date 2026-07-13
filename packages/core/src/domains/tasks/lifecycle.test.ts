import { describe, expect, it } from 'vitest'
import { OPEN_TASK_STATUSES, TASK_STATUSES, TERMINAL_TASK_STATUSES } from './lifecycle'

describe('task lifecycle', () => {
  it('defines one canonical status vocabulary', () => {
    expect(TASK_STATUSES).toEqual([
      'open',
      'in_progress',
      'waiting',
      'blocked',
      'done',
      'cancelled',
    ])
    expect(OPEN_TASK_STATUSES).toEqual(['open', 'in_progress', 'waiting', 'blocked'])
    expect(TERMINAL_TASK_STATUSES).toEqual(['done', 'cancelled'])
  })
})
