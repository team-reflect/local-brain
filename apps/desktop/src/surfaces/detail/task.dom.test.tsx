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

describe('TaskDetail editing', () => {
  it('validates title and saves editable fields', async () => {
    const calls = installTaskDetailBridge()
    renderWithProviders(<TaskDetail id="t1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Title is required')).toBeDefined()
    expect(updateCalls(calls)).toHaveLength(0)

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  Send revised deck  ' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '  Add pricing  ' } })
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'waiting' } })
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Due'), { target: { value: '2026-07-10' } })
    fireEvent.change(screen.getByLabelText('Scheduled'), { target: { value: '2026-07-08' } })
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateCalls(calls)).toHaveLength(1))
    const params = updateCalls(calls)[0]?.args['params'] as unknown[]
    expect(params).toContain('Send revised deck')
    expect(params).toContain('Add pricing')
    expect(params).toContain('waiting')
    expect(params).toContain(3)
    expect(params).toContain('2026-07-10')
    expect(params).toContain('2026-07-08')
    expect(params).toContain(null)
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeDefined()
  })

  it('sets completedAt when status changes to done', async () => {
    const calls = installTaskDetailBridge({ status: 'open', completed_at: null })
    renderWithProviders(<TaskDetail id="t1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'done' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateCalls(calls)).toHaveLength(1))
    const params = updateCalls(calls)[0]?.args['params'] as unknown[]
    expect(params).toContain('done')
    expect(params.some((param) => typeof param === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(param))).toBe(true)
  })

  it('clears completedAt when status changes away from done', async () => {
    const calls = installTaskDetailBridge({ status: 'done', completed_at: '2026-06-18' })
    renderWithProviders(<TaskDetail id="t1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'open' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateCalls(calls)).toHaveLength(1))
    const params = updateCalls(calls)[0]?.args['params'] as unknown[]
    expect(params).toContain('open')
    expect(params).toContain(null)
  })

  it('cancels without saving', async () => {
    const calls = installTaskDetailBridge()
    renderWithProviders(<TaskDetail id="t1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Changed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByRole('heading', { name: 'Send deck' })).toBeDefined()
    expect(updateCalls(calls)).toHaveLength(0)
  })
})
