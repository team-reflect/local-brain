// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { installFakeBridge, renderWithProviders } from '../test/utils'
import { NetworkSurface } from './network'

describe('NetworkSurface', () => {
  it('lets the graph use the full network content width', async () => {
    installFakeBridge({ queryRows: [] })

    const { container } = renderWithProviders(<NetworkSurface tab="graph" />)

    expect(await screen.findByText('Nothing to graph yet')).toBeDefined()
    expect(screen.getByRole('navigation', { name: 'Network' })).toBeDefined()
    const graphLayout = container.querySelector('[data-testid="network-graph-layout"]')
    expect(graphLayout).toBeDefined()
    expect(graphLayout?.className).toContain('overflow-hidden')
    expect(screen.getByRole('navigation', { name: 'Network' }).className).toContain('top-0')
    expect(container.querySelector('[data-testid="network-list-layout"]')).toBeNull()
  })

  it('keeps the subnavigation column for network lists', async () => {
    installFakeBridge({ queryRows: [] })

    const { container } = renderWithProviders(<NetworkSurface tab="people" />)

    expect(await screen.findByText('No people yet')).toBeDefined()
    expect(container.querySelector('[data-testid="network-list-layout"]')).toBeDefined()
    expect(container.querySelector('[data-testid="network-graph-layout"]')).toBeNull()
  })

  it('bounds the graph layout to the available route height', async () => {
    installFakeBridge({ queryRows: [] })

    const { container } = renderWithProviders(<NetworkSurface tab="graph" />)

    await screen.findByText('Nothing to graph yet')
    const layout = container.querySelector('[data-testid="network-graph-layout"]')
    expect(layout).not.toBeNull()
    // h-full + min-h-0 keep the tab inside the scroll container so the page
    // does not grow taller than the route and scroll under the header.
    expect(layout?.className).toContain('h-full')
    expect(layout?.className).toContain('min-h-0')
  })

  it('overlays the graph tabs at the list-tab position to avoid a jump on switch', async () => {
    installFakeBridge({ queryRows: [] })

    const graph = renderWithProviders(<NetworkSurface tab="graph" />)
    expect(await within(graph.container).findByText('Nothing to graph yet')).toBeDefined()
    const graphNav = within(graph.container).getByRole('navigation', { name: 'Network' })
    // Overlaid on the graph, but anchored to the top so it lines up with the
    // in-flow list tabs rather than sitting 9 units lower.
    expect(graphNav.className).toContain('absolute')
    expect(graphNav.className).toContain('top-0')
    expect(graphNav.className).not.toContain('top-9')

    const list = renderWithProviders(<NetworkSurface tab="people" />)
    expect(await within(list.container).findByText('No people yet')).toBeDefined()
    const listNav = within(list.container).getByRole('navigation', { name: 'Network' })
    // The list tabs flow at the top of the layout grid (no absolute offset),
    // which is the position the graph overlay now matches.
    expect(listNav.className).not.toContain('absolute')
    expect(listNav.className).not.toContain('top-9')
  })
})
