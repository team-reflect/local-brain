// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { TodaySurface } from './today'
import {
  deferredCompletionWrite,
  installMutableTaskBridge,
  rawTaskRow,
} from '../test/task-completion-fixtures'
import { renderWithProviders } from '../test/utils'

describe('TodaySurface task completion', () => {
  it('completes an open task from the Today row', async () => {
    const writes = installMutableTaskBridge({
      tasks: [rawTaskRow({ id: 'today-task', title: 'Prepare the daily update' })],
    })
    renderWithProviders(<TodaySurface />)

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete Prepare the daily update' }))

    await waitFor(() => expect(writes).toEqual([
      expect.objectContaining({ id: 'today-task', status: 'done' }),
    ]))
    expect(await screen.findByText('No active tasks')).not.toBeNull()
    expect(screen.queryByText('Prepare the daily update')).toBeNull()
  })

  it('restores a task and announces its failure after optimistic filtering', async () => {
    const deferred = deferredCompletionWrite()
    const writes = installMutableTaskBridge({
      tasks: [rawTaskRow({ id: 'failed-today-task', title: 'Email the launch notes' })],
      completionWrite: deferred.promise,
    })
    renderWithProviders(<TodaySurface />)

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete Email the launch notes' }))

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(await screen.findByText('No active tasks')).not.toBeNull()
    await act(async () => {
      deferred.reject(new Error('Write failed'))
      await deferred.promise.catch(() => undefined)
    })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Could not complete Email the launch notes: Write failed')
    expect(await screen.findByRole('checkbox', { name: 'Complete Email the launch notes' })).not.toBeNull()
  })
})
