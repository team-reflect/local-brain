import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type { Graph, GraphNodeKind } from '@local-brain/core'
import { EmptyState } from '../components/empty-state'
import { Loading } from '../components/loading'
import { PageHead } from '../components/page-head'
import { useGraph } from '../lib/queries'
import { layoutGraph, type GraphLayout, type PositionedNode } from './graph-layout'
import type { Route } from '../routing/route'
import { useRouter } from '../routing/router'

/** A calm, distinguishable color per node kind (Reflect cool palette, indigo self). */
const KIND_COLOR: Record<GraphNodeKind, string> = {
  self: '#4f46e5',
  person: '#2563eb',
  organization: '#7c3aed',
  project: '#059669',
  task: '#0891b2',
  document: '#64748b',
  interaction: '#db2777',
  memory: '#d97706',
}

const KIND_LABEL: Record<GraphNodeKind, string> = {
  self: 'You',
  person: 'People',
  organization: 'Organizations',
  project: 'Projects',
  task: 'Tasks',
  document: 'Documents',
  interaction: 'Interactions',
  memory: 'Memories',
}

const ALL_KINDS = Object.keys(KIND_LABEL) as GraphNodeKind[]
const DEFAULT_VIEWPORT = { offsetX: 0, offsetY: 0, scale: 1 }
const MIN_ZOOM = 0.45
const MAX_ZOOM = 3
const DRAG_CLICK_THRESHOLD = 3

interface GraphViewport {
  offsetX: number
  offsetY: number
  scale: number
}

interface GraphDragState {
  pointerId: number
  clientX: number
  clientY: number
  totalDistance: number
}

interface GraphPoint {
  x: number
  y: number
}

function routeForNode(node: PositionedNode): Route | null {
  switch (node.kind) {
    case 'self':
    case 'person':
      return { kind: 'person', id: node.id }
    case 'organization':
      return { kind: 'organization', id: node.id }
    case 'project':
      return { kind: 'project', id: node.id }
    case 'task':
      return { kind: 'task', id: node.id }
    case 'document':
      return { kind: 'document', id: node.id }
    case 'interaction':
      return { kind: 'interaction', id: node.id }
    case 'memory':
      return null
  }
}

function clip(label: string): string {
  return label.length > 22 ? `${label.slice(0, 21)}…` : label
}

function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))
}

function clientPointToGraphPoint(
  svg: SVGSVGElement,
  layout: Pick<GraphLayout, 'width' | 'height'>,
  clientX: number,
  clientY: number,
): GraphPoint | null {
  const rect = svg.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return {
    x: ((clientX - rect.left) / rect.width) * layout.width,
    y: ((clientY - rect.top) / rect.height) * layout.height,
  }
}

function clientDeltaToGraphDelta(
  svg: SVGSVGElement,
  layout: Pick<GraphLayout, 'width' | 'height'>,
  deltaX: number,
  deltaY: number,
): GraphPoint | null {
  const rect = svg.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return {
    x: (deltaX / rect.width) * layout.width,
    y: (deltaY / rect.height) * layout.height,
  }
}

export function GraphSurface({ showHeader = true }: { showHeader?: boolean } = {}): ReactNode {
  const { navigate } = useRouter()
  const graph = useGraph()
  const [visibleKinds, setVisibleKinds] = useState<ReadonlySet<GraphNodeKind>>(
    () => new Set(ALL_KINDS),
  )
  const [viewport, setViewport] = useState<GraphViewport>(DEFAULT_VIEWPORT)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<GraphDragState | null>(null)
  const suppressNextNodeClickRef = useRef(false)

  const presentKinds = useMemo(() => {
    if (!graph.data) return [] as GraphNodeKind[]
    const seen = new Set(graph.data.nodes.map((node) => node.kind))
    return ALL_KINDS.filter((kind) => seen.has(kind))
  }, [graph.data])

  const filteredGraph = useMemo<Graph | null>(() => {
    if (!graph.data) return null
    return {
      ...graph.data,
      nodes: graph.data.nodes.filter((node) => visibleKinds.has(node.kind)),
      truncatedKinds: graph.data.truncatedKinds.filter((kind) => visibleKinds.has(kind)),
    }
  }, [graph.data, visibleKinds])

  const layout = useMemo(() => (filteredGraph ? layoutGraph(filteredGraph) : null), [filteredGraph])

  const toggleKind = (kind: GraphNodeKind): void => {
    setVisibleKinds((current) => {
      const next = new Set(current)
      if (next.has(kind)) {
        next.delete(kind)
      } else {
        next.add(kind)
      }
      return next
    })
  }

  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !layout) return undefined

    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const cursor = clientPointToGraphPoint(svg, layout, event.clientX, event.clientY)
      if (!cursor) return
      const zoomFactor = Math.exp(-event.deltaY * 0.001)
      setViewport((current) => {
        const nextScale = clampZoom(current.scale * zoomFactor)
        const scaledBy = nextScale / current.scale
        return {
          scale: nextScale,
          offsetX: cursor.x - (cursor.x - current.offsetX) * scaledBy,
          offsetY: cursor.y - (cursor.y - current.offsetY) * scaledBy,
        }
      })
    }

    svg.addEventListener('wheel', handleWheel, { passive: false })
    return () => svg.removeEventListener('wheel', handleWheel)
  }, [layout])

  const handlePointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>): void => {
    if (event.button > 0) return
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      totalDistance: 0,
    }
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }, [])

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>): void => {
      if (!layout) return
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const clientDeltaX = event.clientX - drag.clientX
      const clientDeltaY = event.clientY - drag.clientY
      if (clientDeltaX === 0 && clientDeltaY === 0) return
      const graphDelta = clientDeltaToGraphDelta(
        event.currentTarget,
        layout,
        clientDeltaX,
        clientDeltaY,
      )
      if (!graphDelta) return
      dragRef.current = {
        pointerId: drag.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        totalDistance:
          drag.totalDistance + Math.hypot(Math.abs(clientDeltaX), Math.abs(clientDeltaY)),
      }
      event.preventDefault()
      setViewport((current) => ({
        ...current,
        offsetX: current.offsetX + graphDelta.x,
        offsetY: current.offsetY + graphDelta.y,
      }))
    },
    [layout],
  )

  const finishDrag = useCallback((event: ReactPointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.totalDistance > DRAG_CLICK_THRESHOLD) {
      suppressNextNodeClickRef.current = true
      window.setTimeout(() => {
        suppressNextNodeClickRef.current = false
      }, 0)
    }
    if (typeof event.currentTarget.releasePointerCapture === 'function') {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
  }, [])

  const handleNodeClick = useCallback(
    (route: Route): void => {
      if (suppressNextNodeClickRef.current) {
        suppressNextNodeClickRef.current = false
        return
      }
      navigate(route)
    },
    [navigate],
  )

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      {showHeader ? <PageHead eyebrow="Graph" title="Graph" /> : null}
      {graph.isLoading ? (
        <Loading />
      ) : !graph.data || graph.data.nodes.length === 0 ? (
        <EmptyState
          title="Nothing to graph yet"
          hint="People, projects, and the records that connect them will appear here."
        />
      ) : (
        <div className="relative min-h-[24rem] overflow-hidden">
          <div
            className="absolute top-3 right-3 z-10 flex w-44 flex-col gap-1.5 rounded-md border border-border bg-background/95 p-2 shadow-[0_8px_28px_rgba(2,6,23,0.12)]"
            role="group"
            aria-label="Graph node filters"
          >
            {presentKinds.map((kind) => (
              <label
                key={kind}
                className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <input
                  type="checkbox"
                  checked={visibleKinds.has(kind)}
                  onChange={() => toggleKind(kind)}
                  className="size-3 accent-[hsl(var(--primary))]"
                />
                <span
                  aria-hidden="true"
                  className="inline-block size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: KIND_COLOR[kind] }}
                />
                <span className="min-w-0 truncate">{KIND_LABEL[kind]}</span>
              </label>
            ))}
          </div>
          {!layout || layout.nodes.length === 0 ? (
            <div className="flex min-h-[24rem] items-center justify-center pt-48 sm:pt-0 sm:pr-48">
              <EmptyState
                title="All node types hidden"
                hint="Turn on a node type to draw the graph."
              />
            </div>
          ) : (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              className="h-auto w-full cursor-grab touch-none select-none active:cursor-grabbing"
              role="img"
              aria-label="User-centered knowledge graph"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
            >
              <g
                data-testid="graph-viewport"
                transform={`translate(${viewport.offsetX} ${viewport.offsetY}) scale(${viewport.scale})`}
              >
                <g stroke="hsl(var(--border))" strokeWidth={1}>
                  {layout.edges.map((edge, index) => (
                    <line
                      key={`${edge.source.id}-${edge.target.id}-${index}`}
                      x1={edge.source.x}
                      y1={edge.source.y}
                      x2={edge.target.x}
                      y2={edge.target.y}
                      strokeOpacity={0.5}
                    />
                  ))}
                </g>
                {layout.nodes.map((node) => {
                  const route = routeForNode(node)
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x} ${node.y})`}
                      className={route ? 'cursor-pointer' : undefined}
                      onClick={route ? () => handleNodeClick(route) : undefined}
                    >
                      <circle r={node.radius} fill={KIND_COLOR[node.kind]} />
                      <text
                        x={0}
                        y={node.radius + 12}
                        textAnchor="middle"
                        className="fill-foreground"
                        fontSize={11}
                      >
                        {clip(node.label)}
                      </text>
                    </g>
                  )
                })}
              </g>
            </svg>
          )}
        </div>
      )}
      {!graph.isLoading &&
      graph.data &&
      graph.data.nodes.length > 0 &&
      filteredGraph &&
      filteredGraph.truncatedKinds.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Showing a capped view; more exist for: {filteredGraph.truncatedKinds.join(', ')}.
        </p>
      ) : null}
    </div>
  )
}
