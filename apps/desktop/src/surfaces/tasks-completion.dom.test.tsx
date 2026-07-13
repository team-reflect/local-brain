// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { TasksSurface } from './tasks'
import {
  deferredCompletionWrite,
  installMutableTaskBridge,
  rawTaskRow,
} from '../test/task-completion-fixtures'
import { renderWithProviders } from '../test/utils'

describe('TasksSurface completion', () => {
  it('completes an open task and moves it into Done', async () => {
    const writes = installMutableTaskBridge({
      tasks: [rawTaskRow({ id: 'open-task', title: 'Send the proposal' })],
    })
    renderWithProviders(<TasksSurface />)

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete Send the proposal' }))

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({ id: 'open-task', status: 'done' })
    expect(writes[0]?.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    await waitFor(() => expect(screen.queryByText('Send the proposal')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(await screen.findByRole('checkbox', { name: 'Reopen Send the proposal' })).not.toBeNull()
  })

  it('reopens a done task and returns it to Active', async () => {
    const writes = installMutableTaskBridge({
      tasks: [
        rawTaskRow({
          id: 'done-task',
          title: 'Review launch copy',
          status: 'done',
          completed_at: '2026-07-12T17:00:00.000Z',
        }),
      ],
    })
    renderWithProviders(<TasksSurface />)

    expect(await screen.findByText('No active tasks')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Reopen Review launch copy' }))

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toEqual({ id: 'done-task', status: 'open', completedAt: null })
    await waitFor(() => expect(screen.queryByText('Review launch copy')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Active' }))
    expect(await screen.findByRole('checkbox', { name: 'Complete Review launch copy' })).not.toBeNull()
  })

  it('restores a filtered task and keeps its keyed write failure visible', async () => {
    const deferred = deferredCompletionWrite()
    const writes = installMutableTaskBridge({
      tasks: [rawTaskRow({ id: 'failed-task', title: 'Send the board update' })],
      completionWrite: deferred.promise,
    })
    renderWithProviders(<TasksSurface />)

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete Send the board update' }))

    await waitFor(() => expect(writes).toHaveLength(1))
    await waitFor(() => expect(screen.queryByText('Send the board update')).toBeNull())
    await act(async () => {
      deferred.reject(new Error('Database is read-only'))
      await deferred.promise.catch(() => undefined)
    })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(
      'Could not complete Send the board update: Database is read-only',
    )
    expect(await screen.findByRole('checkbox', { name: 'Complete Send the board update' })).not.toBeNull()
  })
})
