// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { ProjectDetail } from './project'
import { installFakeBridge, renderWithProviders } from '../../test/utils'

const projectRow = {
  id: 'pr1',
  name: 'Launch',
  summary: 'Ship the first version',
  status: 'active',
  target_date: null,
  completed_on: null,
  archived_at: null,
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
  kind: null,
  notes: null,
  started_on: null,
}

const taskRow = {
  id: 't1',
  title: 'Send deck',
  description: 'Draft for Alex',
  status: 'open',
  priority: null,
  project_id: 'pr1',
  due_at: null,
  scheduled_for: null,
  completed_at: null,
  origin_document_id: null,
  origin_interaction_id: null,
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
  archived_at: null,
}

function installProjectBridge(): void {
  installFakeBridge({
    query: (sql) => {
      if (sql.includes('from "projects"') && sql.includes('where "id" = ?')) return [projectRow]
      if (sql.includes('from "tasks"') && sql.includes('where "id" = ?')) return [taskRow]
      if (sql.includes('from "tasks"') && sql.includes('"tasks"."project_id" = ?')) {
        return [{ id: 't1', title: 'Send deck', subtitle: 'open' }]
      }
      if (sql.includes('from "people"') && sql.includes('inner join "project_people"')) {
        return [{ id: 'p1', title: 'Ada Lovelace', subtitle: 'advisor' }]
      }
      if (sql.includes('from "projects"') && !sql.includes('inner join')) return [projectRow]
      return []
    },
  })
}

describe('ProjectDetail task drawer', () => {
  it('opens linked project tasks in a drawer and closes back to the project', async () => {
    installProjectBridge()
    renderWithProviders(<ProjectDetail id="pr1" />)

    expect(await screen.findByRole('heading', { name: 'Launch' })).toBeDefined()
    fireEvent.click(screen.getByText('Send deck').closest('button')!)

    expect(await screen.findByText('Draft for Alex')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Close task details' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Close task details' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close task details' })).toBeNull())
    expect(screen.getByRole('heading', { name: 'Launch' })).toBeDefined()
  })

  it('does not open the task drawer for non-task linked records', async () => {
    installProjectBridge()
    renderWithProviders(<ProjectDetail id="pr1" />)

    fireEvent.click((await screen.findByText('Ada Lovelace')).closest('button')!)

    expect(screen.queryByRole('button', { name: 'Close task details' })).toBeNull()
  })
})
