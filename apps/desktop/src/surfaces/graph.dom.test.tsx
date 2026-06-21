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
    { source: 'self', target: 'p1', kind: 'interaction', weight: 3, interactionId: 'int1' },
  ],
}

vi.mock('../lib/queries', () => ({
  useGraph: () => ({ data: GRAPH, isLoading: false }),
}))

function mockGraphBounds(rect?: { width: number; height: number }): SVGSVGElement {
  const width = rect?.width ?? 880
  const height = rect?.height ?? 760
  const svg = screen.getByRole('img', {
    name: 'User-centered knowledge graph',
  }) as unknown as SVGSVGElement
  Object.defineProperty(svg, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      bottom: height,
      height,
      left: 0,
      right: width,
      top: 0,
      width,
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

  it('maps pan through the uniform letterbox scale, not the per-axis ratio', () => {
    renderWithProviders(<GraphSurface showHeader={false} />)

    // 440x760 box vs an 880x760 viewBox: width-bound, so the graph renders at a
    // uniform scale of 0.5 with vertical letterboxing. An 88px diagonal drag must
    // move the viewport 176 units on BOTH axes — the per-axis ratio would wrongly
    // give 88 on Y.
    const svg = mockGraphBounds({ width: 440, height: 760 })
    const viewport = screen.getByTestId('graph-viewport')

    dispatchPointer(svg, 'pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    dispatchPointer(svg, 'pointermove', { pointerId: 1, clientX: 188, clientY: 188 })
    dispatchPointer(svg, 'pointerup', { pointerId: 1, clientX: 188, clientY: 188 })

    expect(viewport.getAttribute('transform')).toBe('translate(176 176) scale(1)')
  })

  it('anchors zoom on the cursor when the svg is letterboxed', () => {
    renderWithProviders(<GraphSurface showHeader={false} />)

    // Width-bound box (scale 0.5, 190px vertical letterbox). Cursor is above the
    // vertical center so the letterbox offset matters: client (220,200) maps to
    // viewBox (440,20). Zoom must keep that exact point fixed under the cursor.
    const svg = mockGraphBounds({ width: 440, height: 760 })
    const viewport = screen.getByTestId('graph-viewport')

    fireEvent.wheel(svg, { deltaY: -100, clientX: 220, clientY: 200 })

    const match = /^translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)$/.exec(
      viewport.getAttribute('transform') ?? '',
    )
    expect(match).not.toBeNull()
    const [, txRaw, tyRaw, sRaw] = match as RegExpExecArray
    const tx = Number(txRaw)
    const ty = Number(tyRaw)
    const scale = Number(sRaw)
    expect(scale).toBeGreaterThan(1)
    // The viewBox point under the cursor (440,20) stays under the cursor:
    // newOffset + point * newScale === point.
    expect(tx + 440 * scale).toBeCloseTo(440, 5)
    expect(ty + 20 * scale).toBeCloseTo(20, 5)
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

  it('fills its container height with a bounded, non-overflowing svg', () => {
    renderWithProviders(<GraphSurface showHeader={false} />)

    const svg = screen.getByRole('img', { name: 'User-centered knowledge graph' })
    // h-full (not h-auto) keeps the svg inside the route height; with the
    // viewBox + default preserveAspectRatio it letterboxes instead of growing.
    expect(svg.getAttribute('class')).toContain('h-full')
    expect(svg.getAttribute('class')).toContain('w-full')
    expect(svg.getAttribute('class')).not.toContain('h-auto')

    const wrapper = svg.parentElement
    expect(wrapper?.className).toContain('flex-1')
    expect(wrapper?.className).toContain('min-h-0')

    const root = wrapper?.parentElement
    expect(root?.className).toContain('h-full')
    expect(root?.className).toContain('min-h-0')
  })

  it('opens a person node on click', async () => {
    window.history.pushState({}, '', '/network?tab=graph')
    renderWithProviders(<GraphSurface showHeader={false} />)

    fireEvent.click(screen.getByRole('link', { name: 'Open person Ada Lovelace' }))

    await waitFor(() => {
      expect(window.location.pathname).toBe('/people/p1')
    })
  })

  it('opens an organization node on click', async () => {
    window.history.pushState({}, '', '/network?tab=graph')
    renderWithProviders(<GraphSurface showHeader={false} />)

    fireEvent.click(screen.getByRole('link', { name: 'Open organization Analytical Engines' }))

    await waitFor(() => {
      expect(window.location.pathname).toBe('/organizations/org1')
    })
  })

  it('opens a node from the keyboard', async () => {
    window.history.pushState({}, '', '/network?tab=graph')
    renderWithProviders(<GraphSurface showHeader={false} />)

    fireEvent.keyDown(screen.getByRole('link', { name: 'Open person Ada Lovelace' }), {
      key: 'Enter',
    })

    await waitFor(() => {
      expect(window.location.pathname).toBe('/people/p1')
    })
  })

  it('draws interactions as clickable links and opens the interaction on click', async () => {
    window.history.pushState({}, '', '/network?tab=graph')
    const { container } = renderWithProviders(<GraphSurface showHeader={false} />)

    const link = container.querySelector('line[stroke="#db2777"]')
    expect(link).not.toBeNull()

    fireEvent.click(link as Element)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/interactions/int1')
    })
  })

  it('hides interaction links when the Interactions filter is turned off', () => {
    const { container } = renderWithProviders(<GraphSurface showHeader={false} />)

    expect(container.querySelector('line[stroke="#db2777"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Interactions' }))
    expect(container.querySelector('line[stroke="#db2777"]')).toBeNull()
  })
})
