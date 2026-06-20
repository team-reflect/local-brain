// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { installFakeBridge, renderWithProviders } from '../test/utils'
import { NetworkSurface } from './network'

describe('NetworkSurface', () => {
  it('lets the graph use the full network content width', async () => {
    installFakeBridge({ queryRows: [] })

    const { container } = renderWithProviders(<NetworkSurface tab="graph" />)

    expect(await screen.findByText('Nothing to graph yet')).toBeDefined()
    expect(screen.getByRole('navigation', { name: 'Network' })).toBeDefined()
    expect(container.querySelector('[data-testid="network-graph-layout"]')).toBeDefined()
    expect(container.querySelector('[data-testid="network-list-layout"]')).toBeNull()
  })

  it('keeps the subnavigation column for network lists', async () => {
    installFakeBridge({ queryRows: [] })

    const { container } = renderWithProviders(<NetworkSurface tab="people" />)

    expect(await screen.findByText('No people yet')).toBeDefined()
    expect(container.querySelector('[data-testid="network-list-layout"]')).toBeDefined()
    expect(container.querySelector('[data-testid="network-graph-layout"]')).toBeNull()
  })
})
