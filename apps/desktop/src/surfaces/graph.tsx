import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Graph } from '@local-brain/core'
import { Checkbox } from '../components/ui/checkbox'
import { EmptyState } from '../components/empty-state'
import { Loading } from '../components/loading'
import { PageHead } from '../components/page-head'
import { cn } from '../lib/utils'
import { useGraph } from '../lib/queries'
import type { PositionedNode } from './graph-layout'
import { useAsyncGraphLayout } from './use-async-graph-layout'
import {
  clampZoom,
  clientDeltaToGraphDelta,
  clientPointToGraphPoint,
} from './graph-geometry'
import {
  ALL_KINDS,
  HIDDEN_NODE_KINDS,
  KIND_COLOR,
  KIND_LABEL,
  NodeDetailsPanel,
  clip,
  countConnections,
  interactionEdgeWidth,
  routeForNode,
  selectLabelForNode,
  type VisibleGraphFilterKind,
  type VisibleGraphNodeKind,
} from './graph-nodes'
import type { Route } from '../routing/route'
import { useRouter } from '../routing/router'

const DEFAULT_VIEWPORT = { offsetX: 0, offsetY: 0, scale: 1 }
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
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
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

  const layoutState = useAsyncGraphLayout(filteredGraph)
  const layout = layoutState.layout

  const selectedNode = useMemo<PositionedNode | null>(() => {
    if (!layout || !selectedNodeId) return null
    return layout.nodes.find((node) => node.id === selectedNodeId) ?? null
  }, [layout, selectedNodeId])

  const selectedConnectionCount = useMemo(
    () => (layout && selectedNode ? countConnections(layout, selectedNode.id) : 0),
    [layout, selectedNode],
  )

  // Drop the selection if a filter (or refresh) removes the node from the graph.
  useEffect(() => {
    if (!layout || !selectedNodeId) return
    if (!layout.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null)
    }
  }, [layout, selectedNodeId])

  // Escape clears the current selection.
  useEffect(() => {
    if (!selectedNodeId) return undefined
    const handleKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setSelectedNodeId(null)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [selectedNodeId])

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

  // A drag that ends on a node/edge fires a trailing click; this swallows it.
  const consumeSuppressedClick = useCallback((): boolean => {
    if (suppressNextNodeClickRef.current) {
      suppressNextNodeClickRef.current = false
      return true
    }
    return false
  }, [])

  const handleNodeClick = useCallback(
    (event: ReactMouseEvent, nodeId: string): void => {
      // Don't let the click bubble to the background (which clears selection).
      event.stopPropagation()
      if (consumeSuppressedClick()) return
      setSelectedNodeId(nodeId)
    },
    [consumeSuppressedClick],
  )

  const handleNodeKeyDown = useCallback(
    (event: KeyboardEvent<SVGGElement>, nodeId: string): void => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      setSelectedNodeId(nodeId)
    },
    [],
  )

  const handleEdgeClick = useCallback(
    (event: ReactMouseEvent, route: Route): void => {
      event.stopPropagation()
      if (consumeSuppressedClick()) return
      navigate(route)
    },
    [consumeSuppressedClick, navigate],
  )

  // A click on empty canvas clears the selection (unless it was a drag).
  const handleBackgroundClick = useCallback((): void => {
    if (consumeSuppressedClick()) return
    setSelectedNodeId(null)
  }, [consumeSuppressedClick])

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
          <div className="absolute top-3 right-3 z-10 flex w-44 flex-col gap-2">
            <div
              className="flex flex-col gap-1.5 rounded-md border border-border bg-background/95 p-2 shadow-[0_8px_28px_rgba(2,6,23,0.12)]"
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
            {selectedNode ? (
              <NodeDetailsPanel
                node={selectedNode}
                connectionCount={selectedConnectionCount}
                onOpen={() => {
                  const route = routeForNode(selectedNode)
                  if (route) navigate(route)
                }}
                onClose={() => setSelectedNodeId(null)}
              />
            ) : null}
          </div>
          {layoutState.status === 'idle' ? (
            <div className="flex h-full min-h-[24rem] items-center justify-center pt-48 sm:pt-0 sm:pr-48">
              <EmptyState
                title="All node types hidden"
                hint="Turn on a node type to draw the graph."
              />
            </div>
          ) : layoutState.status === 'pending' ? (
            <div className="flex h-full min-h-[24rem] items-center justify-center pt-48 sm:pt-0 sm:pr-48">
              <Loading />
            </div>
          ) : layout ? (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              preserveAspectRatio="xMidYMid meet"
              className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
              role="img"
              aria-label="User-centered knowledge graph"
              onClick={handleBackgroundClick}
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
                        onClick={(event) => handleNodeClick(event, node.id)}
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
                          onClick={route ? (event) => handleEdgeClick(event, route) : undefined}
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
                  const interactive = routeForNode(node) !== null
                  const isSelected = node.id === selectedNodeId
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x} ${node.y})`}
                      className={interactive ? 'cursor-pointer' : undefined}
                      onClick={interactive ? (event) => handleNodeClick(event, node.id) : undefined}
                      onKeyDown={interactive ? (event) => handleNodeKeyDown(event, node.id) : undefined}
                      role={interactive ? 'button' : undefined}
                      aria-pressed={interactive ? isSelected : undefined}
                      tabIndex={interactive ? 0 : undefined}
                      aria-label={interactive ? selectLabelForNode(node) : undefined}
                    >
                      {isSelected ? (
                        <circle
                          r={node.radius + 5}
                          fill="none"
                          stroke={KIND_COLOR[node.kind]}
                          strokeWidth={2.5}
                        />
                      ) : null}
                      <circle
                        r={node.radius}
                        fill={KIND_COLOR[node.kind]}
                        stroke={isSelected ? 'hsl(var(--background))' : undefined}
                        strokeWidth={isSelected ? 2 : undefined}
                      />
                      <text
                        x={0}
                        y={node.radius + 12}
                        textAnchor="middle"
                        className="fill-foreground"
                        fontSize={11}
                        fontWeight={isSelected ? 600 : undefined}
                      >
                        {clip(node.label)}
                      </text>
                    </g>
                  )
                })}
              </g>
            </svg>
          ) : null}
        </div>
      )}
    </div>
  )
}
