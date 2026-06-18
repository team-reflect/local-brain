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

  it('renders the AI providers boundary with an add form and live status', async () => {
    renderWithProviders(<SettingsSurface section="ai-providers" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add provider' })).toBeDefined())
    // The closed-boundary reason surfaces (no provider configured).
    await waitFor(() => expect(screen.getByText(/No AI provider is configured/)).toBeDefined())
  })
})
