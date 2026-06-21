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

  it('renders Settings with the about section selected by default', async () => {
    renderWithProviders(<RouteContent route={{ kind: 'settings' }} />)
    expect(screen.getByRole('heading', { name: 'About' })).toBeDefined()
    expect(
      screen.getByText('Local Brain is a private, local-first, personal knowledge graph.'),
    ).toBeDefined()
    await waitFor(() => expect(screen.getByText('v0.1.0')).toBeDefined())
  })

  it('renders the Chat empty state for the chat route', async () => {
    renderWithProviders(<RouteContent route={{ kind: 'chat' }} />)
    expect(await screen.findByText('Chat with your local brain')).toBeDefined()
  })

  it('shows a not-found state for a missing person', async () => {
    renderWithProviders(<RouteContent route={{ kind: 'person', id: 'ghost' }} />)
    await waitFor(() => expect(screen.getByText('Person not found')).toBeDefined())
  })
})
