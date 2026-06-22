// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { Graph } from '@local-brain/core'
import { renderWithProviders } from '../test/utils'
import { layoutGraph } from './graph-layout'
import { GraphSurface } from './graph'

const GRAPH: Graph = {
  selfId: 'self',
  nodes: [
    { id: 'self', kind: 'self', label: 'You' },
    { id: 'p1', kind: 'person', label: 'Ada Lovelace' },
    { id: 'org1', kind: 'organization', label: 'Analytical Engines' },
    { id: 'm1', kind: 'memory', label: 'Prefers written summaries' },
  ],
  edges: [
    { source: 'self', target: 'p1', kind: 'knows' },
    { source: 'p1', target: 'org1', kind: 'affiliation' },
    { source: 'p1', target: 'm1', kind: 'memory' },
    { source: 'self', target: 'p1', kind: 'interaction', weight: 3, interactionId: 'int1' },
  ],
}

vi.mock('../lib/queries', () => ({
  useGraph: () => ({ data: GRAPH, isLoading: false }),
}))

vi.mock('./graph-layout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./graph-layout')>()
  return {
    ...actual,
    layoutGraph: vi.fn(actual.layoutGraph),
  }
})

const layoutGraphMock = vi.mocked(layoutGraph)

beforeEach(() => {
  layoutGraphMock.mockClear()
})

async function findGraphSvg(): Promise<SVGSVGElement> {
  return await screen.findByRole('img', {
    name: 'User-centered knowledge graph',
  }) as unknown as SVGSVGElement
}

async function mockGraphBounds(rect?: { width: number; height: number }): Promise<SVGSVGElement> {
  const width = rect?.width ?? 880
  const height = rect?.height ?? 760
  const svg = await findGraphSvg()
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
  it('defers graph layout until after the initial tab render', async () => {
    renderWithProviders(<GraphSurface showHeader={false} />)

    expect(screen.getByRole('group', { name: 'Graph node filters' })).toBeDefined()
    expect(screen.getByText('Loading…')).toBeDefined()
    expect(screen.queryByRole('img', { name: 'User-centered knowledge graph' })).toBeNull()
    expect(layoutGraphMock).not.toHaveBeenCalled()

    await findGraphSvg()

    expect(layoutGraphMock).toHaveBeenCalledTimes(1)
  })

  it('lets node types be toggled from the graph legend', async () => {
    renderWithProviders(<GraphSurface showHeader={false} />)

    expect(screen.getByRole('group', { name: 'Graph node filters' })).toBeDefined()
    expect(screen.queryByRole('checkbox', { name: 'Known context' })).toBeNull()
    expect(screen.queryByText('Prefers written summaries')).toBeNull()
    const people = screen.getByRole('checkbox', { name: 'People' })
    expect(people.getAttribute('aria-checked')).toBe('true')
    expect(await screen.findByText('Ada Lovelace')).toBeDefined()
    expect(screen.getByText('Analytical Engines')).toBeDefined()

    fireEvent.click(people)

    expect(people.getAttribute('aria-checked')).toBe('false')
    await waitFor(() => {
      expect(screen.queryByText('Ada Lovelace')).toBeNull()
      expect(screen.getByText('Analytical Engines')).toBeDefined()
    })
  })

  it('pans the graph with pointer drag', async () => {
    renderWithProviders(<GraphSurface showHeader={false} />)

    const svg = await mockGraphBounds()
    const viewport = screen.getByTestId('graph-viewport')
    expect(viewport.getAttribute('transform')).toBe('translate(0 0) scale(1)')

    dispatchPointer(svg, 'pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    dispatchPointer(svg, 'pointermove', { pointerId: 1, clientX: 188, clientY: 100 })
    dispatchPointer(svg, 'pointerup', { pointerId: 1, clientX: 188, clientY: 100 })

    expect(viewport.getAttribute('transform')).toBe('translate(88 0) scale(1)')
  })

  it('maps pan through the uniform letterbox scale, not the per-axis ratio', async () => {
    renderWithProviders(<GraphSurface showHeader={false} />)

    // 440x760 box vs an 880x760 viewBox: width-bound, so the graph renders at a
    // uniform scale of 0.5 with vertical letterboxing. An 88px diagonal drag must
    // move the viewport 176 units on BOTH axes — the per-axis ratio would wrongly
    // give 88 on Y.
    const svg = await mockGraphBounds({ width: 440, height: 760 })
    const viewport = screen.getByTestId('graph-viewport')

    dispatchPointer(svg, 'pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    dispatchPointer(svg, 'pointermove', { pointerId: 1, clientX: 188, clientY: 188 })
    dispatchPointer(svg, 'pointerup', { pointerId: 1, clientX: 188, clientY: 188 })

    expect(viewport.getAttribute('transform')).toBe('translate(176 176) scale(1)')
  })

  it('anchors zoom on the cursor when the svg is letterboxed', async () => {
    renderWithProviders(<GraphSurface showHeader={false} />)

    // Width-bound box (scale 0.5, 190px vertical letterbox). Cursor is above the
    // vertical center so the letterbox offset matters: client (220,200) maps to
    // viewBox (440,20). Zoom must keep that exact point fixed under the cursor.
    const svg = await mockGraphBounds({ width: 440, height: 760 })
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

  it('zooms the graph around the wheel cursor', async () => {
    renderWithProviders(<GraphSurface showHeader={false} />)

    const svg = await mockGraphBounds()
    const viewport = screen.getByTestId('graph-viewport')

    fireEvent.wheel(svg, { deltaY: -100, clientX: 440, clientY: 380 })

    const transform = viewport.getAttribute('transform') ?? ''
    expect(transform).not.toBe('translate(0 0) scale(1)')
    expect(transform).toMatch(/scale\(1\.\d+\)/)
  })

  it('does not open a node after dragging from it', async () => {
    window.history.pushState({}, '', '/network?tab=graph')
    renderWithProviders(<GraphSurface showHeader={false} />)

    await mockGraphBounds()
    const person = await screen.findByText('Ada Lovelace')

    dispatchPointer(person, 'pointerdown', { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
    dispatchPointer(person, 'pointermove', { pointerId: 1, clientX: 150, clientY: 100 })
    dispatchPointer(person, 'pointerup', { pointerId: 1, clientX: 150, clientY: 100 })
    fireEvent.click(person)

    expect(window.location.pathname + window.location.search).toBe('/network?tab=graph')
  })

  it('fills its container height with a bounded, non-overflowing svg', async () => {
    renderWithProviders(<GraphSurface showHeader={false} />)

    const svg = await findGraphSvg()
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

  it('selects a person node and opens it from the details panel', async () => {
    window.history.pushState({}, '', '/network?tab=graph')
    renderWithProviders(<GraphSurface showHeader={false} />)

    const node = await screen.findByRole('button', { name: 'Select person Ada Lovelace' })
    expect(node.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(node)

    expect(node.getAttribute('aria-pressed')).toBe('true')
    const panel = await screen.findByRole('group', { name: 'Selected node' })
    expect(within(panel).getByText('Person')).toBeDefined()
    expect(within(panel).getByText('Ada Lovelace')).toBeDefined()
    // p1 connects to self and the org; the memory edge is dropped with its node.
    expect(within(panel).getByText('2 connections')).toBeDefined()
    // The graph stays put until the panel's open action is used.
    expect(window.location.pathname).toBe('/network')

    fireEvent.click(screen.getByRole('button', { name: 'Open person Ada Lovelace' }))

    await waitFor(() => {
      expect(window.location.pathname).toBe('/people/p1')
    })
  })

  it('opens an organization node from the details panel', async () => {
    window.history.pushState({}, '', '/network?tab=graph')
    renderWithProviders(<GraphSurface showHeader={false} />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Select organization Analytical Engines' }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open organization Analytical Engines' }),
    )

    await waitFor(() => {
      expect(window.location.pathname).toBe('/organizations/org1')
    })
  })

  it('selects a node from the keyboard', async () => {
    window.history.pushState({}, '', '/network?tab=graph')
    renderWithProviders(<GraphSurface showHeader={false} />)

    const node = await screen.findByRole('button', { name: 'Select person Ada Lovelace' })
    fireEvent.keyDown(node, { key: 'Enter' })

    expect(node.getAttribute('aria-pressed')).toBe('true')
    expect(await screen.findByRole('group', { name: 'Selected node' })).toBeDefined()
    // Selecting alone never navigates.
    expect(window.location.pathname).toBe('/network')
  })

  it('clears the selection on Escape and on a background click', async () => {
    renderWithProviders(<GraphSurface showHeader={false} />)

    const svg = await mockGraphBounds()
    fireEvent.click(await screen.findByRole('button', { name: 'Select person Ada Lovelace' }))
    expect(await screen.findByRole('group', { name: 'Selected node' })).toBeDefined()

    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: 'Selected node' })).toBeNull()
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Select person Ada Lovelace' }))
    expect(await screen.findByRole('group', { name: 'Selected node' })).toBeDefined()

    fireEvent.click(svg)
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: 'Selected node' })).toBeNull()
    })
  })

  it('drops the selection when its node is filtered out', async () => {
    renderWithProviders(<GraphSurface showHeader={false} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Select person Ada Lovelace' }))
    expect(await screen.findByRole('group', { name: 'Selected node' })).toBeDefined()

    fireEvent.click(screen.getByRole('checkbox', { name: 'People' }))

    await waitFor(() => {
      expect(screen.queryByRole('group', { name: 'Selected node' })).toBeNull()
    })
  })

  it('does not resurrect the panel after every node type is filtered off', async () => {
    renderWithProviders(<GraphSurface showHeader={false} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Select person Ada Lovelace' }))
    expect(await screen.findByRole('group', { name: 'Selected node' })).toBeDefined()

    // Hide every node type — there is no layout object in this state at all.
    fireEvent.click(screen.getByRole('checkbox', { name: 'You' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'People' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Organizations' }))

    await waitFor(() => {
      expect(screen.queryByRole('group', { name: 'Selected node' })).toBeNull()
    })

    // Re-showing the node's type must not bring the panel back without a click.
    fireEvent.click(screen.getByRole('checkbox', { name: 'People' }))
    await screen.findByRole('button', { name: 'Select person Ada Lovelace' })
    expect(screen.queryByRole('group', { name: 'Selected node' })).toBeNull()
  })

  it('draws interactions as clickable links and opens the interaction on click', async () => {
    window.history.pushState({}, '', '/network?tab=graph')
    const { container } = renderWithProviders(<GraphSurface showHeader={false} />)

    await findGraphSvg()
    const link = container.querySelector('line[stroke="#db2777"]')
    expect(link).not.toBeNull()

    fireEvent.click(link as Element)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/interactions/int1')
    })
  })

  it('keeps enlarged node hit targets below interaction links', async () => {
    renderWithProviders(<GraphSurface showHeader={false} />)

    const hitLayer = await screen.findByTestId('graph-node-hit-layer')
    const interactionLayer = screen.getByTestId('graph-interaction-edge-layer')

    expect(hitLayer.compareDocumentPosition(interactionLayer) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    )
  })

  it('hides interaction links when the Interactions filter is turned off', async () => {
    const { container } = renderWithProviders(<GraphSurface showHeader={false} />)

    await findGraphSvg()
    expect(container.querySelector('line[stroke="#db2777"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Interactions' }))
    await waitFor(() => {
      expect(container.querySelector('line[stroke="#db2777"]')).toBeNull()
    })
  })
})
