// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { ProjectDetail } from './project'
import {
  installMutableTaskBridge,
  rawTaskRow,
} from '../../test/task-completion-fixtures'
import { renderWithProviders } from '../../test/utils'

const PROJECT_ROW = {
  id: 'project-1',
  name: 'Launch',
  summary: null,
  status: 'active',
  target_date: null,
  completed_on: null,
  archived_at: null,
  created_at: '2026-07-01T08:00:00.000Z',
  updated_at: '2026-07-01T08:00:00.000Z',
  kind: null,
  notes: null,
  started_on: null,
}

describe('linked task completion', () => {
  it('toggles the shared linked-task row without opening task navigation', async () => {
    const writes = installMutableTaskBridge({
      tasks: [
        rawTaskRow({
          id: 'linked-task',
          title: 'Confirm launch date',
          project_id: 'project-1',
        }),
      ],
      query: (sql) => {
        if (sql.includes('from "projects"') && !sql.includes('inner join')) return [PROJECT_ROW]
        return undefined
      },
    })
    renderWithProviders(<ProjectDetail id="project-1" />)

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete Confirm launch date' }))

    await waitFor(() => expect(writes).toEqual([
      expect.objectContaining({ id: 'linked-task', status: 'done' }),
    ]))
    expect(await screen.findByRole('checkbox', { name: 'Reopen Confirm launch date' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Close task details' })).toBeNull()
  })
})
