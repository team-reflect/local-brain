import type { Graph, GraphNode, GraphNodeKind } from '@local-brain/core'

/**
 * A deterministic, dependency-free radial layout for the user-centered graph.
 * The self row sits at the center; every other node is placed on a concentric
 * ring chosen by its kind and distributed evenly around that ring. Pure and
 * synchronous so it can be unit-tested without a DOM.
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

/** Which concentric ring (index into RING_RADII) a node kind lives on. */
const RING_FOR_KIND: Record<GraphNodeKind, number> = {
  self: 0,
  person: 1,
  organization: 2,
  project: 2,
  task: 3,
  interaction: 3,
  document: 4,
  memory: 4,
}

const RING_RADII = [0, 115, 200, 285, 350]
/** A per-ring angular offset so adjacent rings don't visually line up. */
const RING_PHASE = [0, 0, 0.5, 0.9, 1.3]

export function layoutGraph(graph: Graph, options: LayoutOptions = {}): GraphLayout {
  const width = options.width ?? 880
  const height = options.height ?? 760
  const cx = width / 2
  const cy = height / 2

  // Bucket nodes by ring, preserving the order the getter returned them in.
  const rings: GraphNode[][] = RING_RADII.map(() => [])
  for (const node of graph.nodes) {
    rings[RING_FOR_KIND[node.kind]]?.push(node)
  }

  const positioned = new Map<string, PositionedNode>()
  rings.forEach((ringNodes, ring) => {
    const radius = RING_RADII[ring] ?? 0
    const phase = RING_PHASE[ring] ?? 0
    ringNodes.forEach((node, index) => {
      const isCenter = ring === 0
      const angle = phase + (2 * Math.PI * index) / Math.max(ringNodes.length, 1)
      positioned.set(node.id, {
        ...node,
        x: isCenter ? cx : cx + radius * Math.cos(angle),
        y: isCenter ? cy : cy + radius * Math.sin(angle),
        radius: node.kind === 'self' ? 13 : 7,
      })
    })
  })

  const edges: PositionedEdge[] = []
  for (const edge of graph.edges) {
    const source = positioned.get(edge.source)
    const target = positioned.get(edge.target)
    if (source && target) edges.push({ source, target, kind: edge.kind })
  }

  return { width, height, nodes: [...positioned.values()], edges }
}
