// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { Graph } from '@local-brain/core'
import { renderWithProviders } from '../test/utils'
import { GraphSurface } from './graph'

const GRAPH: Graph = {
  selfId: 'self',
  nodes: [
    { id: 'self', kind: 'self', label: 'You' },
    { id: 'p1', kind: 'person', label: 'Ada Lovelace' },
    { id: 'org1', kind: 'organization', label: 'Analytical Engines' },
  ],
  edges: [
    { source: 'self', target: 'p1', kind: 'knows' },
    { source: 'p1', target: 'org1', kind: 'affiliation' },
  ],
}

vi.mock('../lib/queries', () => ({
  useGraph: () => ({ data: GRAPH, isLoading: false }),
}))

function mockGraphBounds(): SVGSVGElement {
  const svg = screen.getByRole('img', {
    name: 'User-centered knowledge graph',
  }) as unknown as SVGSVGElement
  Object.defineProperty(svg, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      bottom: 760,
      height: 760,
      left: 0,
      right: 880,
      top: 0,
      width: 880,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  })
  Object.defineProperty(svg, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(svg, 'releasePointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  return svg
}

function dispatchPointer(
  target: Element,
  type: string,
  init: { pointerId: number; clientX: number; clientY: number; button?: number },
): void {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    button: { value: init.button ?? 0 },
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
    pointerId: { value: init.pointerId },
  })
  fireEvent(target, event)
}

describe('GraphSurface', () => {
  it('lets node types be toggled from the graph legend', () => {
    renderWithProviders(<GraphSurface showHeader={false} />)

    expect(screen.getByRole('group', { name: 'Graph node filters' })).toBeDefined()
    const people = screen.getByRole('checkbox', { name: 'People' })
    expect(people.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Ada Lovelace')).toBeDefined()
    expect(screen.getByText('Analytical Engines')).toBeDefined()

    fireEvent.click(people)

    expect(people.getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByText('Ada Lovelace')).toBeNull()
    expect(screen.getByText('Analytical Engines')).toBeDefined()
  })

  it('pans the graph with pointer drag', () => {
    renderWithProviders(<GraphSurface showHeader={false} />)

    const svg = mockGraphBounds()
    const viewport = screen.getByTestId('graph-viewport')
    expect(viewport.getAttribute('transform')).toBe('translate(0 0) scale(1)')

    dispatchPointer(svg, 'pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    dispatchPointer(svg, 'pointermove', { pointerId: 1, clientX: 188, clientY: 100 })
    dispatchPointer(svg, 'pointerup', { pointerId: 1, clientX: 188, clientY: 100 })

    expect(viewport.getAttribute('transform')).toBe('translate(88 0) scale(1)')
  })

  it('zooms the graph around the wheel cursor', () => {
    renderWithProviders(<GraphSurface showHeader={false} />)

    const svg = mockGraphBounds()
    const viewport = screen.getByTestId('graph-viewport')

    fireEvent.wheel(svg, { deltaY: -100, clientX: 440, clientY: 380 })

    const transform = viewport.getAttribute('transform') ?? ''
    expect(transform).not.toBe('translate(0 0) scale(1)')
    expect(transform).toMatch(/scale\(1\.\d+\)/)
  })

  it('does not open a node after dragging from it', () => {
    window.history.pushState({}, '', '/network?tab=graph')
    renderWithProviders(<GraphSurface showHeader={false} />)

    mockGraphBounds()
    const person = screen.getByText('Ada Lovelace')

    dispatchPointer(person, 'pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    dispatchPointer(person, 'pointermove', { pointerId: 1, clientX: 150, clientY: 100 })
    dispatchPointer(person, 'pointerup', { pointerId: 1, clientX: 150, clientY: 100 })
    fireEvent.click(person)

    expect(window.location.pathname + window.location.search).toBe('/network?tab=graph')
  })

  it('still opens a node on click', async () => {
    window.history.pushState({}, '', '/network?tab=graph')
    renderWithProviders(<GraphSurface showHeader={false} />)

    fireEvent.click(screen.getByText('Ada Lovelace'))

    await waitFor(() => {
      expect(window.location.pathname).toBe('/people/p1')
    })
  })
})
