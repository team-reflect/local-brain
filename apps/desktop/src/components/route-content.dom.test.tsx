// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { RouteContent } from './route-content'
import { installFakeBridge, renderWithProviders } from '../test/utils'

describe('RouteContent', () => {
  beforeEach(() => {
    // Every db_query resolves to no rows, so surfaces render their empty states.
    installFakeBridge({ queryRows: [] })
  })

  it('renders the Today brief for the today route', async () => {
    renderWithProviders(<RouteContent route={{ kind: 'today' }} />)
    expect(await screen.findByText(/Good to see you/)).toBeDefined()
    expect(screen.getByText('Daily brief')).toBeDefined()
  })

  it('renders the graph empty state when there are no records', async () => {
    renderWithProviders(<RouteContent route={{ kind: 'network', tab: 'graph' }} />)
    expect(await screen.findByText('Nothing to graph yet')).toBeDefined()
  })

  it('renders the Ask intro for a fresh conversation', () => {
    renderWithProviders(<RouteContent route={{ kind: 'ask' }} />)
    expect(screen.getByText(/Ask a question about your brain/)).toBeDefined()
  })

  it('renders Settings with the general section selected by default', () => {
    renderWithProviders(<RouteContent route={{ kind: 'settings' }} />)
    expect(screen.getByRole('heading', { name: 'General' })).toBeDefined()
    expect(screen.getByText(/private, local-first personal CRM/)).toBeDefined()
  })

  it('shows a not-found state for a missing person', async () => {
    renderWithProviders(<RouteContent route={{ kind: 'person', id: 'ghost' }} />)
    await waitFor(() => expect(screen.getByText('Person not found')).toBeDefined())
  })
})
