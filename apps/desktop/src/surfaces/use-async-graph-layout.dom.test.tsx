// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Graph } from '@local-brain/core'
import type { GraphLayout } from './graph-layout'
import {
  useAsyncGraphLayout,
  type GraphLayoutComputer,
  type GraphLayoutScheduler,
} from './use-async-graph-layout'

const GRAPH: Graph = {
  selfId: 'self',
  nodes: [
    { id: 'self', kind: 'self', label: 'You' },
    { id: 'p1', kind: 'person', label: 'Ada Lovelace' },
  ],
  edges: [{ source: 'self', target: 'p1', kind: 'knows' }],
}

const EMPTY_GRAPH: Graph = {
  selfId: null,
  nodes: [],
  edges: [],
}

const LAYOUT: GraphLayout = {
  width: 880,
  height: 760,
  nodes: [
    { id: 'self', kind: 'self', label: 'You', x: 440, y: 380, radius: 13 },
    { id: 'p1', kind: 'person', label: 'Ada Lovelace', x: 520, y: 380, radius: 7 },
  ],
  edges: [],
}

function Probe({
  computeLayout,
  graph,
  schedule,
}: {
  computeLayout: GraphLayoutComputer
  graph: Graph | null
  schedule: GraphLayoutScheduler
}) {
  const state = useAsyncGraphLayout(graph, { computeLayout, schedule })

  return (
    <div>
      <p>{state.status}</p>
      <p>{state.layout?.nodes.length ?? 'no-layout'}</p>
    </div>
  )
}

describe('useAsyncGraphLayout', () => {
  it('waits for the scheduler before computing graph layout', async () => {
    const callbacks: Array<() => void> = []
    const schedule = vi.fn<GraphLayoutScheduler>((callback) => {
      callbacks.push(callback)
      return vi.fn()
    })
    const computeLayout = vi.fn<GraphLayoutComputer>(() => LAYOUT)

    render(<Probe graph={GRAPH} schedule={schedule} computeLayout={computeLayout} />)

    expect(await screen.findByText('pending')).toBeDefined()
    expect(screen.getByText('no-layout')).toBeDefined()
    expect(schedule).toHaveBeenCalledTimes(1)
    expect(computeLayout).not.toHaveBeenCalled()

    act(() => callbacks[0]?.())

    expect(await screen.findByText('ready')).toBeDefined()
    expect(screen.getByText('2')).toBeDefined()
    expect(computeLayout).toHaveBeenCalledTimes(1)
    expect(computeLayout).toHaveBeenCalledWith(GRAPH)
  })

  it('does not compute stale scheduled layouts after cleanup', async () => {
    const callbacks: Array<() => void> = []
    const cancel = vi.fn()
    const schedule = vi.fn<GraphLayoutScheduler>((callback) => {
      callbacks.push(callback)
      return cancel
    })
    const computeLayout = vi.fn<GraphLayoutComputer>(() => LAYOUT)

    const { rerender } = render(
      <Probe graph={GRAPH} schedule={schedule} computeLayout={computeLayout} />,
    )
    expect(await screen.findByText('pending')).toBeDefined()

    rerender(<Probe graph={null} schedule={schedule} computeLayout={computeLayout} />)

    expect(await screen.findByText('idle')).toBeDefined()
    expect(cancel).toHaveBeenCalledTimes(1)

    act(() => callbacks[0]?.())

    expect(computeLayout).not.toHaveBeenCalled()
    expect(screen.getByText('idle')).toBeDefined()
  })

  it('stays idle when there are no visible graph nodes', async () => {
    const schedule = vi.fn<GraphLayoutScheduler>(() => vi.fn())
    const computeLayout = vi.fn<GraphLayoutComputer>(() => LAYOUT)

    render(<Probe graph={EMPTY_GRAPH} schedule={schedule} computeLayout={computeLayout} />)

    await waitFor(() => {
      expect(screen.getByText('idle')).toBeDefined()
    })
    expect(screen.getByText('no-layout')).toBeDefined()
    expect(schedule).not.toHaveBeenCalled()
    expect(computeLayout).not.toHaveBeenCalled()
  })
})
