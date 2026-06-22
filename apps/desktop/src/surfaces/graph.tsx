import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type { Graph, GraphNodeKind } from '@local-brain/core'
import { Checkbox } from '../components/ui/checkbox'
import { EmptyState } from '../components/empty-state'
import { Loading } from '../components/loading'
import { PageHead } from '../components/page-head'
import { cn } from '../lib/utils'
import { useGraph } from '../lib/queries'
import { layoutGraph, type GraphLayout, type PositionedNode } from './graph-layout'
import type { Route } from '../routing/route'
import { useRouter } from '../routing/router'

type GraphFilterKind = GraphNodeKind | 'interaction'
type VisibleGraphNodeKind = Exclude<GraphNodeKind, 'memory'>
type VisibleGraphFilterKind = VisibleGraphNodeKind | 'interaction'

/** A calm, distinguishable color per kind (Reflect cool palette, indigo self). */
const KIND_COLOR: Record<GraphFilterKind, string> = {
  self: '#4f46e5',
  person: '#2563eb',
  organization: '#7c3aed',
  project: '#059669',
  task: '#0891b2',
  document: '#64748b',
  interaction: '#db2777',
  memory: '#d97706',
}

const KIND_LABEL: Record<VisibleGraphFilterKind, string> = {
  self: 'You',
  person: 'People',
  organization: 'Organizations',
  project: 'Projects',
  task: 'Tasks',
  document: 'Documents',
  interaction: 'Interactions',
}

const ALL_KINDS = Object.keys(KIND_LABEL) as VisibleGraphFilterKind[]
const HIDDEN_NODE_KINDS = new Set<GraphNodeKind>(['memory'])
const DEFAULT_VIEWPORT = { offsetX: 0, offsetY: 0, scale: 1 }
const MIN_ZOOM = 0.45
const MAX_ZOOM = 3
const DRAG_CLICK_THRESHOLD = 3
const MIN_NODE_HIT_RADIUS = 16

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
    case 'memory': return null
  }
}

function actionLabelForNode(node: PositionedNode): string {
  const kind = node.kind === 'self' ? 'person' : node.kind
  return `Open ${kind} ${node.label}`
}

function clip(label: string): string {
  return label.length > 22 ? `${label.slice(0, 21)}…` : label
}

/** Thicken an interaction edge by how many interactions connect the pair. */
function interactionEdgeWidth(weight: number | undefined): number {
  return Math.min(6, 1.25 + Math.log2((weight ?? 1) + 1) * 1.1)
}

function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))
}

function scheduleAfterPaint(callback: () => void): () => void {
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

function useAsyncGraphLayout(graph: Graph | null): GraphLayout | null {
  const [layout, setLayout] = useState<GraphLayout | null>(null)

  useEffect(() => {
    if (!graph || graph.nodes.length === 0) {
      setLayout(null)
      return undefined
    }

    let active = true
    setLayout(null)
    const cancel = scheduleAfterPaint(() => {
      const nextLayout = layoutGraph(graph)
      if (!active) return
      startTransition(() => {
        if (active) setLayout(nextLayout)
      })
    })

    return () => {
      active = false
      cancel()
    }
  }, [graph])

  return layout
}

interface FitTransform {
  /** Pixels per viewBox unit (uniform — the viewBox keeps its aspect ratio). */
  scale: number
  /** Letterbox padding on each axis, from `xMidYMid` centering. */
  offsetX: number
  offsetY: number
}

/**
 * How the viewBox lands inside the rendered SVG box under the default
 * `xMidYMid meet`: scaled uniformly to fit, then centered. Pointer math must go
 * through this — the box can be wider/taller than the viewBox, so mapping across
 * the full rect would drift on letterboxed (height-bounded) routes.
 */
function fitTransform(
  rect: { width: number; height: number },
  layout: Pick<GraphLayout, 'width' | 'height'>,
): FitTransform | null {
  if (rect.width <= 0 || rect.height <= 0) return null
  if (layout.width <= 0 || layout.height <= 0) return null
  const scale = Math.min(rect.width / layout.width, rect.height / layout.height)
  return {
    scale,
    offsetX: (rect.width - layout.width * scale) / 2,
    offsetY: (rect.height - layout.height * scale) / 2,
  }
}

function clientPointToGraphPoint(
  svg: SVGSVGElement,
  layout: Pick<GraphLayout, 'width' | 'height'>,
  clientX: number,
  clientY: number,
): GraphPoint | null {
  const rect = svg.getBoundingClientRect()
  const fit = fitTransform(rect, layout)
  if (!fit) return null
  return {
    x: (clientX - rect.left - fit.offsetX) / fit.scale,
    y: (clientY - rect.top - fit.offsetY) / fit.scale,
  }
}

function clientDeltaToGraphDelta(
  svg: SVGSVGElement,
  layout: Pick<GraphLayout, 'width' | 'height'>,
  deltaX: number,
  deltaY: number,
): GraphPoint | null {
  const rect = svg.getBoundingClientRect()
  const fit = fitTransform(rect, layout)
  if (!fit) return null
  // Centering offsets cancel for a delta; only the uniform scale matters.
  return {
    x: deltaX / fit.scale,
    y: deltaY / fit.scale,
  }
}

export function GraphSurface({
  showHeader = true,
  className,
}: {
  showHeader?: boolean
  className?: string
} = {}): ReactNode {
  const { navigate } = useRouter()
  const graph = useGraph()
  const [visibleKinds, setVisibleKinds] = useState<ReadonlySet<VisibleGraphFilterKind>>(
    () => new Set(ALL_KINDS),
  )
  const [viewport, setViewport] = useState<GraphViewport>(DEFAULT_VIEWPORT)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<GraphDragState | null>(null)
  const suppressNextNodeClickRef = useRef(false)

  const presentKinds = useMemo(() => {
    if (!graph.data) return [] as VisibleGraphFilterKind[]
    const seen = new Set<VisibleGraphFilterKind>()
    for (const node of graph.data.nodes) {
      if (!HIDDEN_NODE_KINDS.has(node.kind) && node.kind in KIND_LABEL) {
        seen.add(node.kind as VisibleGraphNodeKind)
      }
    }
    if (graph.data.edges.some((edge) => edge.kind === 'interaction')) seen.add('interaction')
    return ALL_KINDS.filter((kind) => seen.has(kind))
  }, [graph.data])

  const filteredGraph = useMemo<Graph | null>(() => {
    if (!graph.data) return null
    const showInteractions = visibleKinds.has('interaction')
    const nodes = graph.data.nodes.filter((node) => !HIDDEN_NODE_KINDS.has(node.kind))
      .filter((node) => visibleKinds.has(node.kind as VisibleGraphNodeKind))
    const nodeIds = new Set(nodes.map((node) => node.id))
    return {
      ...graph.data,
      nodes,
      edges: graph.data.edges.filter(
        (edge) =>
          (showInteractions || edge.kind !== 'interaction') &&
          nodeIds.has(edge.source) &&
          nodeIds.has(edge.target),
      ),
    }
  }, [graph.data, visibleKinds])

  const layout = useAsyncGraphLayout(filteredGraph)
  const hasVisibleGraphNodes = (filteredGraph?.nodes.length ?? 0) > 0

  const toggleKind = (kind: VisibleGraphFilterKind): void => {
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

  const handleNodeKeyDown = useCallback(
    (event: KeyboardEvent<SVGGElement>, route: Route): void => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      navigate(route)
    },
    [navigate],
  )

  return (
    <div className={cn('mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col gap-4', className)}>
      {showHeader ? <PageHead eyebrow="Graph" title="Graph" /> : null}
      {graph.isLoading ? (
        <Loading />
      ) : !graph.data || graph.data.nodes.length === 0 ? (
        <EmptyState
          title="Nothing to graph yet"
          hint="People, projects, and the records that connect them will appear here."
          variant="plain"
        />
      ) : (
        <div className="relative min-h-0 flex-1 overflow-hidden">
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
                <Checkbox
                  checked={visibleKinds.has(kind)}
                  onCheckedChange={() => toggleKind(kind)}
                  aria-label={KIND_LABEL[kind]}
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-block shrink-0 rounded-full',
                    // Interactions are links, not nodes — show a bar, not a dot.
                    kind === 'interaction' ? 'h-0.5 w-2.5' : 'size-2.5',
                  )}
                  style={{ backgroundColor: KIND_COLOR[kind] }}
                />
                <span className="min-w-0 truncate">{KIND_LABEL[kind]}</span>
              </label>
            ))}
          </div>
          {!hasVisibleGraphNodes ? (
            <div className="flex h-full min-h-[24rem] items-center justify-center pt-48 sm:pt-0 sm:pr-48">
              <EmptyState
                title="All node types hidden"
                hint="Turn on a node type to draw the graph."
              />
            </div>
          ) : !layout ? (
            <div className="flex h-full min-h-[24rem] items-center justify-center pt-48 sm:pt-0 sm:pr-48">
              <Loading />
            </div>
          ) : (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              preserveAspectRatio="xMidYMid meet"
              className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
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
                  {layout.edges
                    .filter((edge) => edge.kind !== 'interaction')
                    .map((edge, index) => (
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
                <g data-testid="graph-node-hit-layer">
                  {layout.nodes.map((node) => {
                    const route = routeForNode(node)
                    if (!route) return null
                    return (
                      <circle
                        key={`hit-${node.id}`}
                        cx={node.x}
                        cy={node.y}
                        r={Math.max(node.radius, MIN_NODE_HIT_RADIUS)}
                        fill="transparent"
                        pointerEvents="all"
                        className="cursor-pointer"
                        onClick={() => handleNodeClick(route)}
                      />
                    )
                  })}
                </g>
                <g data-testid="graph-interaction-edge-layer">
                  {layout.edges
                    .filter((edge) => edge.kind === 'interaction')
                    .map((edge, index) => {
                      const route: Route | null = edge.interactionId
                        ? { kind: 'interaction', id: edge.interactionId }
                        : null
                      return (
                        <g
                          key={`interaction-${edge.source.id}-${edge.target.id}-${index}`}
                          className={route ? 'cursor-pointer' : undefined}
                          onClick={route ? () => handleNodeClick(route) : undefined}
                        >
                          {/* Wide transparent hit area so thin links are easy to click. */}
                          <line
                            x1={edge.source.x}
                            y1={edge.source.y}
                            x2={edge.target.x}
                            y2={edge.target.y}
                            stroke="transparent"
                            strokeWidth={12}
                          />
                          <line
                            x1={edge.source.x}
                            y1={edge.source.y}
                            x2={edge.target.x}
                            y2={edge.target.y}
                            stroke={KIND_COLOR.interaction}
                            strokeWidth={interactionEdgeWidth(edge.weight)}
                            strokeOpacity={0.55}
                            strokeLinecap="round"
                          />
                        </g>
                      )
                    })}
                </g>
                {layout.nodes.map((node) => {
                  const route = routeForNode(node)
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x} ${node.y})`}
                      className={route ? 'cursor-pointer' : undefined}
                      onClick={route ? () => handleNodeClick(route) : undefined}
                      onKeyDown={route ? (event) => handleNodeKeyDown(event, route) : undefined}
                      role={route ? 'link' : undefined}
                      tabIndex={route ? 0 : undefined}
                      aria-label={route ? actionLabelForNode(node) : undefined}
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
    </div>
  )
}
