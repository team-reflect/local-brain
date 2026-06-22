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
  const [state, setState] = useState<AsyncGraphLayoutState>(IDLE_STATE)

  useEffect(() => {
    if (!graph || graph.nodes.length === 0) {
      setState(IDLE_STATE)
      return undefined
    }

    let active = true
    setState(PENDING_STATE)
    const cancel = schedule(() => {
      if (!active) return
      const layout = computeLayout(graph)
      if (!active) return
      startTransition(() => {
        if (active) setState({ status: 'ready', layout })
      })
    })

    return () => {
      active = false
      cancel()
    }
  }, [computeLayout, graph, schedule])

  return state
}
