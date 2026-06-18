// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
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

function installBrainBridge(captured: Captured[]): void {
  installFakeBridge({
    respond: (command, args) => {
      captured.push({ command, args })
      switch (command) {
        case 'active_brain':
          return ACTIVE
        case 'list_brains':
          return [WORK, ACTIVE]
        case 'open_brain':
          return WORK
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
})
