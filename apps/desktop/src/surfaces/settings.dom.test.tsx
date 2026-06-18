// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
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
    expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'General' })).toBeDefined()
  })

  it('renders AI providers as a Reflect-style row card with an add dialog', async () => {
    renderWithProviders(<SettingsSurface section="ai-providers" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add provider' })).toBeDefined())
    expect(screen.getByText(/No AI providers configured/)).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }))

    expect(await screen.findByRole('dialog', { name: 'Add AI provider' })).toBeDefined()
    expect(screen.getByText('Provider')).toBeDefined()
    expect(screen.getByText('Default model')).toBeDefined()
    expect(screen.getByText('API key')).toBeDefined()
  })
})
