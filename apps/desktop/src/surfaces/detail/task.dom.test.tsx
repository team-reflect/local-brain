// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { TaskDetail } from './task'
import { installFakeBridge, renderWithProviders } from '../../test/utils'

interface CapturedCall {
  command: string
  args: Record<string, unknown>
}

interface TaskRow {
  id: string
  title: string
  description: string | null
  status: string
  priority: number | null
  project_id: string | null
  due_at: string | null
  scheduled_for: string | null
  completed_at: string | null
  origin_document_id: string | null
  origin_interaction_id: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

const taskRow: TaskRow = {
  id: 't1',
  title: 'Send deck',
  description: 'Old notes',
  status: 'open',
  priority: 2,
  project_id: 'pr1',
  due_at: '2026-07-01',
  scheduled_for: null,
  completed_at: null,
  origin_document_id: null,
  origin_interaction_id: null,
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
  archived_at: null,
}

const projectRow = {
  id: 'pr1',
  name: 'Launch',
  summary: null,
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

function installTaskDetailBridge(overrides: Partial<TaskRow> = {}): CapturedCall[] {
  const calls: CapturedCall[] = []
  const row = { ...taskRow, ...overrides }
  installFakeBridge({
    respond: (command, args) => {
      calls.push({ command, args })
      return undefined
    },
    query: (sql) => {
      if (sql.includes('from "tasks"') && sql.includes('where "id" = ?')) return [row]
      if (sql.includes('from "projects"') && !sql.includes('inner join')) return [projectRow]
      return []
    },
  })
  return calls
}

function updateCalls(calls: CapturedCall[]): CapturedCall[] {
  return calls.filter(
    (call) => call.command === 'db_execute' && String(call.args['sql']).includes('update "tasks"'),
  )
}

async function waitForUpdate(calls: CapturedCall[]): Promise<unknown[]> {
  await waitFor(() => expect(updateCalls(calls).length).toBeGreaterThan(0))
  return updateCalls(calls).at(-1)?.args['params'] as unknown[]
}

describe('TaskDetail inline editing', () => {
  it('autosaves editable fields inline', async () => {
    const calls = installTaskDetailBridge()
    renderWithProviders(<TaskDetail id="t1" />)

    expect(await screen.findByRole('button', { name: 'Edit title' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByLabelText('Title')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Edit title' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  Send revised deck  ' } })
    fireEvent.blur(screen.getByLabelText('Title'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }))
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '  Add pricing  ' } })
    fireEvent.blur(screen.getByLabelText('Description'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit status' }))
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'waiting' } })
    fireEvent.blur(screen.getByLabelText('Status'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit priority' }))
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: '3' } })
    fireEvent.blur(screen.getByLabelText('Priority'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit due' }))
    fireEvent.change(screen.getByLabelText('Due'), { target: { value: '2026-07-10' } })
    fireEvent.blur(screen.getByLabelText('Due'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit scheduled' }))
    fireEvent.change(screen.getByLabelText('Scheduled'), { target: { value: '2026-07-08' } })
    fireEvent.blur(screen.getByLabelText('Scheduled'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit project' }))
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: '' } })

    const params = await waitForUpdate(calls)
    expect(params).toContain('Send revised deck')
    expect(params).toContain('Add pricing')
    expect(params).toContain('waiting')
    expect(params).toContain(3)
    expect(params).toContain('2026-07-10')
    expect(params).toContain('2026-07-08')
    expect(params).toContain(null)
  })

  it('does not save an invalid blank title', async () => {
    const calls = installTaskDetailBridge()
    renderWithProviders(<TaskDetail id="t1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit title' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '   ' } })

    expect(await screen.findByText('Title is required')).toBeDefined()
    expect(updateCalls(calls)).toHaveLength(0)
  })

  it('sets completedAt when status changes to done', async () => {
    const calls = installTaskDetailBridge({ status: 'open', completed_at: null })
    renderWithProviders(<TaskDetail id="t1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit status' }))
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'done' } })

    const params = await waitForUpdate(calls)
    expect(params).toContain('done')
    expect(params.some((param) => typeof param === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(param))).toBe(true)
  })

  it('clears completedAt when status changes away from done', async () => {
    const calls = installTaskDetailBridge({ status: 'done', completed_at: '2026-06-18' })
    renderWithProviders(<TaskDetail id="t1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit status' }))
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'open' } })

    const params = await waitForUpdate(calls)
    expect(params).toContain('open')
    expect(params).toContain(null)
  })
})
