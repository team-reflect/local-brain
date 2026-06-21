// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { installFakeBridge, renderWithProviders } from '../test/utils'
import { NetworkSurface } from './network'

Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get: () => 1024,
})
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get: () => 768,
})
Element.prototype.getBoundingClientRect = () => ({
  width: 1024,
  height: 768,
  top: 0,
  left: 0,
  right: 1024,
  bottom: 768,
  x: 0,
  y: 0,
  toJSON: () => ({}),
})

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

  it('shows organization headlines in the organizations table', async () => {
    installFakeBridge({
      query: (sql) =>
        sql.includes('from "organizations"')
          ? [
              {
                id: 'org-1',
                name: 'Northwind Labs',
                kind: 'company',
                domain: 'northwind.example',
                headline: 'Local-first research studio',
                summary: null,
                website: null,
                industry: null,
                location: null,
                hqCity: null,
                hqRegion: null,
                hqCountry: null,
                notes: null,
                createdAt: '2026-06-21T00:00:00.000Z',
                updatedAt: '2026-06-21T00:00:00.000Z',
                archivedAt: null,
              },
            ]
          : [],
    })

    renderWithProviders(<NetworkSurface tab="organizations" />)

    expect(await screen.findByRole('columnheader', { name: 'Headline' })).toBeDefined()
    expect(await screen.findByText('Local-first research studio')).toBeDefined()
    expect(screen.queryByRole('columnheader', { name: 'Kind' })).toBeNull()
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
    expect(graphNav.className).not.toContain('shadow-')

    const list = renderWithProviders(<NetworkSurface tab="people" />)
    expect(await within(list.container).findByText('No people yet')).toBeDefined()
    const listNav = within(list.container).getByRole('navigation', { name: 'Network' })
    // The list tabs flow at the top of the layout grid (no absolute offset),
    // which is the position the graph overlay now matches.
    expect(listNav.className).not.toContain('absolute')
    expect(listNav.className).not.toContain('top-9')
  })

  it('sizes person and organization detail sheets for their content density', () => {
    installFakeBridge({ queryRows: [] })

    const person = renderWithProviders(
      <NetworkSurface tab="people" detail={{ kind: 'person', id: 'p1' }} />,
    )
    const personDrawer = document.querySelector('[data-slot="drawer-content"]')

    expect(personDrawer).not.toBeNull()
    expect(personDrawer?.className).toContain('min-w-[36rem]')
    expect(personDrawer?.className).toContain('w-[min(40rem,calc(100vw-4rem))]')

    person.unmount()

    renderWithProviders(
      <NetworkSurface tab="organizations" detail={{ kind: 'organization', id: 'org1' }} />,
    )
    const organizationDrawer = document.querySelector('[data-slot="drawer-content"]')

    expect(organizationDrawer).not.toBeNull()
    expect(organizationDrawer?.className).toContain('min-w-[44rem]')
    expect(organizationDrawer?.className).toContain('w-[min(52rem,calc(100vw-4rem))]')
  })
})
