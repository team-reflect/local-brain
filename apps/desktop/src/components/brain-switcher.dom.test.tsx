// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { BrainSwitcher } from './brain-switcher'
import { installFakeBridge, renderWithProviders } from '../test/utils'

const ACTIVE = {
  rootPath: '/data/My brain',
  databasePath: '/data/My brain/brain.sqlite',
  assetsPath: '/data/My brain/assets',
  name: 'My brain',
  color: 'indigo',
  createdMs: 1,
  lastOpenedMs: 2,
  isActive: true,
  schemaVersion: 2,
}
const WORK = {
  rootPath: '/data/Work',
  databasePath: '/data/Work/brain.sqlite',
  assetsPath: '/data/Work/assets',
  name: 'Work',
  color: 'teal',
  createdMs: 1,
  lastOpenedMs: 3,
  isActive: false,
  schemaVersion: null,
}

interface Captured {
  command: string
  args: Record<string, unknown>
}

function installBrainBridge(
  captured: Captured[],
  respond?: (command: string) => unknown,
): void {
  installFakeBridge({
    respond: (command, args) => {
      captured.push({ command, args })
      const response = respond?.(command)
      if (response !== undefined) return response
      switch (command) {
        case 'active_brain':
          return ACTIVE
        case 'list_brains':
          return [WORK, ACTIVE]
        case 'open_brain':
          return { ...WORK, isActive: true }
        default:
          return undefined
      }
    },
  })
}

function openBrainMenu(): void {
  const trigger = screen.getByRole('button', { name: /My brain/ })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('BrainSwitcher', () => {
  it('shows the active brain and switches to another from the menu', async () => {
    const captured: Captured[] = []
    installBrainBridge(captured)
    renderWithProviders(<BrainSwitcher />)

    // The active brain's name anchors the sidebar brand slot.
    await waitFor(() => expect(screen.getByText('My brain')).toBeDefined())

    // Opening the menu reveals the other brain; selecting it switches.
    openBrainMenu()
    const workItem = await screen.findByText('Work')
    fireEvent.click(workItem)

    await waitFor(() =>
      expect(
        captured.some(
          (call) => call.command === 'open_brain' && call.args['rootPath'] === '/data/Work',
        ),
      ).toBe(true),
    )
  })

  it('opens the new-brain dialog from the menu', async () => {
    installBrainBridge([])
    renderWithProviders(<BrainSwitcher />)
    await waitFor(() => expect(screen.getByText('My brain')).toBeDefined())

    openBrainMenu()
    fireEvent.click(await screen.findByText('New brain…'))

    expect(await screen.findByRole('dialog', { name: 'New brain' })).toBeDefined()
    expect(screen.getByText('Create brain')).toBeDefined()
  })

  it.each([
    {
      command: 'open_brain',
      item: 'Work',
      pending: 'Opening brain…',
      error: 'Could not open this brain. Try again or open another brain.',
      result: { ...WORK, isActive: true },
    },
    {
      command: 'reveal_brain',
      item: 'Reveal in file manager',
      pending: 'Opening folder…',
      error: 'Could not reveal this folder. Try again.',
      result: null,
    },
  ])('keeps $command feedback accessible and allows a failed action to retry', async (scenario) => {
    const captured: Captured[] = []
    const first = deferred<unknown>()
    let attempts = 0
    installBrainBridge(captured, (command) => {
      if (command !== scenario.command) return undefined
      attempts += 1
      return attempts === 1 ? first.promise : scenario.result
    })
    renderWithProviders(<BrainSwitcher />)
    const trigger = await screen.findByRole('button', { name: 'My brain' })

    openBrainMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: scenario.item }))
    expect((await screen.findByRole('status')).textContent).toBe(scenario.pending)
    expect(trigger.getAttribute('aria-busy')).toBe('true')
    for (const item of screen.getAllByRole('menuitem')) {
      expect(item.getAttribute('aria-disabled')).toBe('true')
      fireEvent.click(item)
    }
    expect(attempts).toBe(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(captured.filter((call) => ['open_brain', 'reveal_brain'].includes(call.command)))
      .toHaveLength(1)

    // Escape remains available; feedback follows the picker outside the menu.
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(screen.getByRole('status').textContent).toBe(scenario.pending)
    await act(async () => first.reject(new Error('could not read /private/secret/brain.sqlite')))
    expect((await screen.findByRole('alert')).textContent).toBe(scenario.error)
    expect(screen.getByRole('alert').textContent).not.toContain('/private')
    expect(trigger.getAttribute('aria-busy')).toBe('false')

    openBrainMenu()
    expect((await screen.findByRole('alert')).textContent).toBe(scenario.error)
    const retry = screen.getByRole('menuitem', { name: scenario.item })
    expect(retry.getAttribute('aria-disabled')).not.toBe('true')
    fireEvent.click(retry)
    await waitFor(() => expect(attempts).toBe(2))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('keeps a failed switch in the menu and offers another folder', async () => {
    installBrainBridge([], (command) => command === 'open_brain'
      ? Promise.reject(new Error('folder unavailable'))
      : undefined)
    renderWithProviders(<BrainSwitcher />)
    await screen.findByRole('button', { name: 'My brain' })

    openBrainMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Work' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('menu')).toBeDefined()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open another brain…' }))

    expect(await screen.findByRole('dialog', { name: 'Open another brain' })).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
