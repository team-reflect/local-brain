// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { SettingsSurface } from '.'
import { installFakeBridge, renderWithProviders } from '../../test/utils'

const ACTIVE = {
  rootPath: '/data/local-brain',
  databasePath: '/data/local-brain/brain.sqlite',
  assetsPath: '/data/local-brain/assets',
  name: 'My brain',
  color: 'indigo',
  createdMs: 1,
  lastOpenedMs: 2,
  isActive: true,
  schemaVersion: 2,
}
describe('Settings → Brain', () => {
  it('renders the active brain identity, color popover, folder, and bottom destructive action', async () => {
    installFakeBridge({
      respond: (command) => {
        switch (command) {
          case 'active_brain':
            return ACTIVE
          case 'list_brains':
            return [ACTIVE]
          case 'database_path':
            return ACTIVE.databasePath
          default:
            return undefined
        }
      },
    })

    renderWithProviders(<SettingsSurface section="brain" />)

    await waitFor(() => expect(screen.getByText('My brain')).toBeDefined())
    const brainSection = screen.getByRole('heading', { name: 'Brain' }).closest('section')
    expect(brainSection).not.toBeNull()
    const brain = within(brainSection!)

    expect(brain.getByText('Name')).toBeDefined()
    expect(brain.getByText('Color')).toBeDefined()
    expect(brain.getByText('Folder')).toBeDefined()
    expect(brain.getByText('/data/local-brain')).toBeDefined()
    expect(brain.queryByText('Database')).toBeNull()
    expect(brain.queryByText('/data/local-brain/brain.sqlite')).toBeNull()
    expect(brain.queryByText('Assets')).toBeNull()
    expect(brain.queryByText('/data/local-brain/assets')).toBeNull()
    expect(brain.queryByText('Schema')).toBeNull()
    expect(brain.queryByText('Created')).toBeNull()
    expect(brain.queryByText('Last opened')).toBeNull()
    expect(brain.queryByText('All brains')).toBeNull()
    expect(brain.queryByRole('button', { name: 'Switch' })).toBeNull()
    expect(brain.queryByRole('button', { name: 'Forget brain' })).toBeNull()

    const destructive = screen.getByRole('region', { name: 'Destructive settings' })
    expect(within(destructive).getByRole('heading', { name: 'Destructive' })).toBeDefined()
    expect(within(destructive).getByRole('button', { name: 'Forget brain' })).toBeDefined()

    expect(screen.queryByRole('button', { name: 'Teal' })).toBeNull()
    fireEvent.click(brain.getByRole('button', { name: 'Brain color' }))
    expect(await screen.findByRole('button', { name: 'Teal' })).toBeDefined()
  })

  it('forgets the active brain from settings after confirmation', async () => {
    const calls: Array<{ command: string; args: Record<string, unknown> }> = []
    let active: typeof ACTIVE | null = ACTIVE
    let brains = [ACTIVE]
    installFakeBridge({
      respond: (command, args) => {
        calls.push({ command, args })
        switch (command) {
          case 'active_brain':
            return active
          case 'list_brains':
            return brains
          case 'forget_brain':
            active = null
            brains = []
            return []
          case 'database_path':
            return ACTIVE.databasePath
          default:
            return undefined
        }
      },
    })

    renderWithProviders(<SettingsSurface section="brain" />)

    await waitFor(() => expect(screen.getByText('My brain')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'Forget brain' }))

    const dialog = await screen.findByRole('dialog', { name: 'Forget My brain' })
    expect(within(dialog).getByText(/does not delete the folder/)).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Forget brain' }))

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.command === 'forget_brain' && call.args['rootPath'] === '/data/local-brain',
        ),
      ).toBe(true),
    )
    await waitFor(() => expect(screen.getByText('No active brain.')).toBeDefined())
  })
})
