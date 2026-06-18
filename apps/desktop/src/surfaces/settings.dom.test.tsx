// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { setModelProvider } from '@local-brain/core'
import { SettingsSurface } from './settings'
import { installFakeBridge, renderWithProviders } from '../test/utils'

describe('SettingsSurface (Plan 08)', () => {
  beforeEach(() => {
    setModelProvider(null)
    installFakeBridge({ queryRows: [] })
  })

  it('does not expose backup & export settings', () => {
    renderWithProviders(<SettingsSurface section="backup" />)
    expect(screen.queryByText('Backup & export')).toBeNull()
    expect(screen.queryByText('Create backup')).toBeNull()
    expect(screen.queryByText('Export JSON')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeDefined()
  })

  it('renders the model-keys boundary with a key input and live status', async () => {
    renderWithProviders(<SettingsSurface section="model-keys" />)
    await waitFor(() => expect(screen.getByText('Save key')).toBeDefined())
    // The closed-boundary reason surfaces (no provider configured).
    await waitFor(() => expect(screen.getByText(/No model provider is configured/)).toBeDefined())
  })
})
