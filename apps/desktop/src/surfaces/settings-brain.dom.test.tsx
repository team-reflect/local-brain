// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { SettingsSurface } from './settings'
import { installFakeBridge, renderWithProviders } from '../test/utils'

const ACTIVE = {
  path: '/data/local-brain/brain.sqlite',
  name: 'My brain',
  color: 'indigo',
  createdMs: 1,
  lastOpenedMs: 2,
  isActive: true,
  schemaVersion: 2,
}
const WORK = {
  path: '/data/local-brain/work.sqlite',
  name: 'Work',
  color: 'teal',
  createdMs: 1,
  lastOpenedMs: 3,
  isActive: false,
  schemaVersion: null,
}

describe('Settings → Brain', () => {
  it('renders the active brain identity, color picker, and the other brains', async () => {
    installFakeBridge({
      respond: (command) => {
        switch (command) {
          case 'active_brain':
            return ACTIVE
          case 'list_brains':
            return [WORK, ACTIVE]
          case 'database_path':
            return ACTIVE.path
          default:
            return undefined
        }
      },
    })

    renderWithProviders(<SettingsSurface section="brain" />)

    // Identity: name + path of the active brain (the path also appears in the
    // Local database section, so allow more than one match).
    await waitFor(() => expect(screen.getByText('My brain')).toBeDefined())
    expect(screen.getAllByText('/data/local-brain/brain.sqlite').length).toBeGreaterThan(0)

    // The color picker exposes every brain color as a labelled control.
    expect(screen.getByRole('button', { name: 'Teal' })).toBeDefined()

    // The other brain is listed with a Switch action.
    expect(screen.getByText('Work')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Switch' })).toBeDefined()
  })
})
