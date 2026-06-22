import { startTransition, useEffect, useState } from 'react'
import type { Graph } from '@local-brain/core'
import { layoutGraph, type GraphLayout } from './graph-layout'

/** The layout lifecycle consumed by GraphSurface's empty/loading/SVG branches. */
export type AsyncGraphLayoutState =
  | { status: 'idle'; layout: null }
  | { status: 'pending'; layout: null }
  | { status: 'ready'; layout: GraphLayout }

export type GraphLayoutScheduler = (callback: () => void) => () => void
export type GraphLayoutComputer = (graph: Graph) => GraphLayout

interface UseAsyncGraphLayoutOptions {
  schedule?: GraphLayoutScheduler
  computeLayout?: GraphLayoutComputer
}

const IDLE_STATE: AsyncGraphLayoutState = { status: 'idle', layout: null }
const PENDING_STATE: AsyncGraphLayoutState = { status: 'pending', layout: null }

type StoredGraphLayoutState = AsyncGraphLayoutState & { graph: Graph | null }

const STORED_IDLE_STATE: StoredGraphLayoutState = { ...IDLE_STATE, graph: null }

/** Schedule layout work after the browser has had a chance to paint the tab chrome. */
export function scheduleGraphLayoutAfterPaint(callback: () => void): () => void {
  let timeoutId: number | undefined
  let frameId: number | undefined

  const run = (): void => {
    timeoutId = window.setTimeout(callback, 0)
  }

  if (typeof window.requestAnimationFrame === 'function') {
    frameId = window.requestAnimationFrame(run)
  } else {
    run()
  }

  return () => {
    if (frameId !== undefined) window.cancelAnimationFrame(frameId)
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
  }
}

/** Build graph layout outside render and expose its lifecycle explicitly to the surface. */
export function useAsyncGraphLayout(
  graph: Graph | null,
  options: UseAsyncGraphLayoutOptions = {},
): AsyncGraphLayoutState {
  const { computeLayout = layoutGraph, schedule = scheduleGraphLayoutAfterPaint } = options
  const [state, setState] = useState<StoredGraphLayoutState>(STORED_IDLE_STATE)
  const hasGraphNodes = (graph?.nodes.length ?? 0) > 0

  useEffect(() => {
    if (!hasGraphNodes || !graph) {
      setState(STORED_IDLE_STATE)
      return undefined
    }

    let active = true
    setState({ ...PENDING_STATE, graph })
    const cancel = schedule(() => {
      if (!active) return
      const layout = computeLayout(graph)
      if (!active) return
      startTransition(() => {
        if (active) setState({ status: 'ready', layout, graph })
      })
    })

    return () => {
      active = false
      cancel()
    }
  }, [computeLayout, graph, hasGraphNodes, schedule])

  if (!hasGraphNodes) return IDLE_STATE
  return state.graph === graph ? state : PENDING_STATE
}
