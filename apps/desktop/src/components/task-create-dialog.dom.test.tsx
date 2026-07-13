// @vitest-environment jsdom
import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { blockingModalOpen } from '../lib/commands/modal-guard'
import { TaskCreateDialog } from './task-create-dialog'
import { installFakeBridge, renderWithProviders } from '../test/utils'

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

interface CapturedCall {
  command: string
  args: Record<string, unknown>
}

function Harness({
  onCreated,
  onClose = () => {},
}: {
  onCreated: (id: string) => void
  onClose?: () => void
}): ReactNode {
  const [open, setOpen] = useState(true)
  return (
    <TaskCreateDialog
      open={open}
      onClose={() => {
        onClose()
        setOpen(false)
      }}
      onCreated={onCreated}
    />
  )
}

describe('TaskCreateDialog', () => {
  it('creates a task with its workflow fields, reports the id, and closes', async () => {
    const calls: CapturedCall[] = []
    const onCreated = vi.fn<(id: string) => void>()
    installFakeBridge({
      query: (sql) => sql.includes('from "projects"') ? [PROJECT_ROW] : [],
      respond: (command, args) => {
        calls.push({ command, args })
        return undefined
      },
    })
    renderWithProviders(<Harness onCreated={onCreated} />)

    fireEvent.change(await screen.findByLabelText('Title'), {
      target: { value: '  Ship the launch plan  ' },
    })
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'waiting' } })
    const projectSelect = screen.getByLabelText<HTMLSelectElement>('Project')
    await waitFor(() => expect(projectSelect.disabled).toBe(false))
    fireEvent.change(projectSelect, { target: { value: 'project-1' } })
    fireEvent.change(screen.getByLabelText('Due'), { target: { value: '2026-07-20' } })
    fireEvent.change(screen.getByLabelText('Scheduled'), { target: { value: '2026-07-16' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    let insertCall: CapturedCall | undefined
    await waitFor(() => {
      insertCall = calls.find(
        (call) =>
          call.command === 'db_execute' &&
          String(call.args['sql']).includes('insert into "tasks"'),
      )
      expect(insertCall).toBeDefined()
    })

    const params = insertCall?.args['params'] as unknown[]
    const createdId = params.at(-1)
    expect(params).toEqual([
      'Ship the launch plan',
      'waiting',
      null,
      'project-1',
      '2026-07-20',
      '2026-07-16',
      expect.any(String),
    ])
    expect(onCreated).toHaveBeenCalledWith(createdId)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('distinguishes project loading and failure from an intentional unlinked task', async () => {
    let projectAttempts = 0
    let rejectProjects: (error: Error) => void = () => {}
    const firstProjectQuery = new Promise<unknown[]>((_resolve, reject) => {
      rejectProjects = reject
    })
    installFakeBridge({
      query: (sql) => {
        if (!sql.includes('from "projects"')) return []
        projectAttempts += 1
        return projectAttempts === 1
          ? firstProjectQuery
          : [PROJECT_ROW]
      },
    })
    renderWithProviders(<Harness onCreated={() => {}} />)

    const projectSelect = await screen.findByLabelText<HTMLSelectElement>('Project')
    expect(projectSelect.disabled).toBe(true)
    expect(screen.getByRole('option', { name: 'Loading projects…' })).not.toBeNull()
    expect(screen.queryByRole('option', { name: 'No project' })).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Create task' }).disabled).toBe(true)

    await act(async () => rejectProjects(new Error('project query failed')))
    expect(await screen.findByText('Could not load projects')).not.toBeNull()
    expect(screen.getByRole('option', { name: 'Projects unavailable' })).not.toBeNull()
    expect(screen.queryByRole('option', { name: 'No project' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(projectSelect.disabled).toBe(false))
    expect(screen.getByRole('option', { name: 'No project' })).not.toBeNull()
    expect(screen.getByRole('option', { name: 'Launch' })).not.toBeNull()
    expect(projectAttempts).toBe(2)
  })

  it('blocks dismissal and global shortcuts while creation is pending', async () => {
    let resolveWrite: (value: number) => void = () => {}
    const write = new Promise<number>((resolve) => {
      resolveWrite = resolve
    })
    const onClose = vi.fn()
    const onCreated = vi.fn<(id: string) => void>()
    installFakeBridge({
      query: (sql) => sql.includes('from "projects"') ? [] : [],
      respond: (command) => command === 'db_execute' ? write : undefined,
    })
    renderWithProviders(<Harness onClose={onClose} onCreated={onCreated} />)

    const title = await screen.findByLabelText('Title')
    const projectSelect = screen.getByLabelText<HTMLSelectElement>('Project')
    await waitFor(() => expect(projectSelect.disabled).toBe(false))
    await waitFor(() => expect(blockingModalOpen()).toBe(true))
    fireEvent.change(title, { target: { value: 'Keep this dialog open' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    expect((await screen.findByRole<HTMLButtonElement>('button', { name: 'Creating…' })).disabled).toBe(true)

    fireEvent.keyDown(title, { key: 'Escape', code: 'Escape' })
    const overlay = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')
    expect(overlay).not.toBeNull()
    fireEvent.pointerDown(overlay!)
    fireEvent.click(overlay!)

    expect(screen.getByRole('dialog')).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(blockingModalOpen()).toBe(true)

    await act(async () => resolveWrite(1))
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => expect(blockingModalOpen()).toBe(false))
  })
})
