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

  it('renders the backup & export actions', async () => {
    renderWithProviders(<SettingsSurface section="backup" />)
    await waitFor(() => expect(screen.getByText('Create backup')).toBeDefined())
    expect(screen.getByText('Export JSON')).toBeDefined()
  })

  it('renders the model-keys boundary with a key input and live status', async () => {
    renderWithProviders(<SettingsSurface section="model-keys" />)
    await waitFor(() => expect(screen.getByText('Save key')).toBeDefined())
    // The closed-boundary reason surfaces (no provider configured).
    await waitFor(() => expect(screen.getByText(/No model provider is configured/)).toBeDefined())
  })
})
