// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { SettingsSurface } from './settings'
import { installFakeBridge, renderWithProviders } from '../test/utils'

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
  it('renders the active brain identity, color popover, and folder only', async () => {
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

    expect(screen.queryByRole('button', { name: 'Teal' })).toBeNull()
    fireEvent.click(brain.getByRole('button', { name: 'Brain color' }))
    expect(await screen.findByRole('button', { name: 'Teal' })).toBeDefined()
  })
})
