import type { Graph, GraphNode, GraphNodeKind } from '@local-brain/core'

/**
 * A deterministic, dependency-free radial layout for the user-centered graph.
 * The self row sits at the center; every other node is placed in a concentric
 * kind band. Dense bands grow into additional rings instead of forcing the data
 * getter to truncate. Pure and synchronous so it can be unit-tested without a
 * DOM.
 */

export interface PositionedNode extends GraphNode {
  x: number
  y: number
  radius: number
}

export interface PositionedEdge {
  source: PositionedNode
  target: PositionedNode
  kind: string
  /** For interaction edges: how many interactions connect this pair. */
  weight?: number
  /** For interaction edges: the interaction to open when the edge is clicked. */
  interactionId?: string
}

export interface GraphLayout {
  width: number
  height: number
  nodes: PositionedNode[]
  edges: PositionedEdge[]
}

export interface LayoutOptions {
  width?: number
  height?: number
}

/** Which concentric band a node kind lives on. */
const BAND_FOR_KIND: Record<GraphNodeKind, number> = {
  self: 0,
  person: 1,
  organization: 2,
  project: 2,
  task: 3,
  document: 4,
  memory: 4,
}

/** A per-band angular offset so adjacent bands don't visually line up. */
const BAND_PHASE = [0, 0, 0.5, 0.9, 1.3]
const DEFAULT_WIDTH = 880
const DEFAULT_HEIGHT = 760
const FIRST_RING_RADIUS = 115
const BAND_GAP = 78
const RING_GAP = 42
const MIN_NODE_SPACING = 34
const OUTER_MARGIN = 56

interface PolarNode {
  node: GraphNode
  radius: number
  angle: number
}

function ringCapacity(radius: number): number {
  return Math.max(6, Math.floor((2 * Math.PI * radius) / MIN_NODE_SPACING))
}

export function layoutGraph(graph: Graph, options: LayoutOptions = {}): GraphLayout {
  // Bucket nodes by band, preserving the order the getter returned them in.
  const bands: GraphNode[][] = BAND_PHASE.map(() => [])
  for (const node of graph.nodes) {
    bands[BAND_FOR_KIND[node.kind]]?.push(node)
  }

  const polarNodes: PolarNode[] = []
  let outerRadius = 0
  let nextRadius = FIRST_RING_RADIUS

  const selfNodes = bands[0] ?? []
  selfNodes.forEach((node, index) => {
    polarNodes.push({
      node,
      radius: index === 0 ? 0 : FIRST_RING_RADIUS,
      angle: (2 * Math.PI * index) / Math.max(selfNodes.length, 1),
    })
  })
  if (selfNodes.length > 1) {
    outerRadius = FIRST_RING_RADIUS
    nextRadius = FIRST_RING_RADIUS + BAND_GAP
  }

  for (let band = 1; band < bands.length; band += 1) {
    const bandNodes = bands[band] ?? []
    if (bandNodes.length === 0) continue
    let remaining = bandNodes.length
    let start = 0
    let radius = Math.max(nextRadius, outerRadius + BAND_GAP)
    while (remaining > 0) {
      const count = Math.min(remaining, ringCapacity(radius))
      const phase = BAND_PHASE[band] ?? 0
      for (let index = 0; index < count; index += 1) {
        polarNodes.push({
          node: bandNodes[start + index]!,
          radius,
          angle: phase + (2 * Math.PI * index) / count,
        })
      }
      outerRadius = Math.max(outerRadius, radius)
      start += count
      remaining -= count
      radius += RING_GAP
    }
    nextRadius = outerRadius + BAND_GAP
  }

  const naturalSize = outerRadius > 0 ? outerRadius * 2 + OUTER_MARGIN * 2 : 0
  const width = Math.max(options.width ?? DEFAULT_WIDTH, naturalSize)
  const height = Math.max(options.height ?? DEFAULT_HEIGHT, naturalSize)
  const cx = width / 2
  const cy = height / 2

  const positioned = new Map<string, PositionedNode>()
  for (const item of polarNodes) {
    positioned.set(item.node.id, {
      ...item.node,
      x: item.radius === 0 ? cx : cx + item.radius * Math.cos(item.angle),
      y: item.radius === 0 ? cy : cy + item.radius * Math.sin(item.angle),
      radius: item.node.kind === 'self' ? 13 : 7,
    })
  }

  const edges: PositionedEdge[] = []
  for (const edge of graph.edges) {
    const source = positioned.get(edge.source)
    const target = positioned.get(edge.target)
    if (!source || !target) continue
    const positionedEdge: PositionedEdge = { source, target, kind: edge.kind }
    if (edge.weight !== undefined) positionedEdge.weight = edge.weight
    if (edge.interactionId !== undefined) positionedEdge.interactionId = edge.interactionId
    edges.push(positionedEdge)
  }

  return { width, height, nodes: [...positioned.values()], edges }
}
