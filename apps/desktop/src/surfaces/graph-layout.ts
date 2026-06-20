import type { Graph, GraphNodeKind } from '@local-brain/core'
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'

/**
 * A force-directed layout for the user-centered graph, run to convergence and
 * returned statically (no animation). The self row is pinned at the center; the
 * rest settle under a weighted spring/charge simulation so that people who share
 * interactions cluster together — interaction edges pull harder and shorter the
 * more often you interact, while structural edges (knows/owns/member/…) act as
 * weak scaffolding. A faint radial force keeps a loose, legible "kind band" feel
 * (people inner, documents/memories outer) instead of a free-floating hairball.
 *
 * The simulation is deterministic: positions are seeded from a fixed radial
 * placement, d3-force uses its own seeded PRNG, and we tick a fixed number of
 * times — so the same graph always produces the same layout. Pure and
 * synchronous, so it can be unit-tested without a DOM.
 */

export interface PositionedNode {
  id: string
  kind: GraphNodeKind
  label: string
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

/** Which concentric band a node kind loosely belongs to. */
const BAND_FOR_KIND: Record<GraphNodeKind, number> = {
  self: 0,
  person: 1,
  organization: 2,
  project: 2,
  task: 3,
  document: 4,
  memory: 4,
}

/** Target ring radius per band — drives both the seed and the radial force. */
const BAND_RADIUS = [0, 150, 250, 340, 430]
/** A per-band angular offset so seeded bands don't line up before relaxing. */
const BAND_PHASE = [0, 0, 0.5, 0.9, 1.3]

const DEFAULT_WIDTH = 880
const DEFAULT_HEIGHT = 760
const OUTER_MARGIN = 56

// Hand-tuned force parameters. Adjust here to retune the layout's feel.
const CHARGE = -260 // node repulsion (Barnes-Hut)
const COLLIDE_RADIUS = 30 // keeps nodes (and their labels) from piling up
const LINK_DIST_STRUCTURE = 120 // resting length of knows/owns/member/… springs
const LINK_DIST_INTERACTION = 80 // base resting length of interaction springs
const STRUCTURE_PULL = 0.04 // weak: structure only scaffolds
const INTERACTION_PULL = 0.25 // per-interaction clustering pull, capped at 1
const RADIAL_PULL = 0.045 // faint band bias to stay legible
const ITERATIONS = 300 // fixed ticks ≈ default alpha cool-down

interface SimNode extends SimulationNodeDatum {
  id: string
  kind: GraphNodeKind
  label: string
  band: number
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  kind: string
  weight?: number
  interactionId?: string
}

/** Deterministically seed origin-centered positions from a radial placement. */
function seedPositions(nodes: SimNode[]): void {
  const byBand = new Map<number, SimNode[]>()
  for (const node of nodes) {
    const group = byBand.get(node.band) ?? []
    group.push(node)
    byBand.set(node.band, group)
  }
  for (const [band, group] of byBand) {
    const radius = BAND_RADIUS[band] ?? BAND_RADIUS[BAND_RADIUS.length - 1]!
    const phase = BAND_PHASE[band] ?? 0
    group.forEach((node, index) => {
      if (radius === 0) {
        node.x = 0
        node.y = 0
        return
      }
      const angle = phase + (2 * Math.PI * index) / group.length
      node.x = radius * Math.cos(angle)
      node.y = radius * Math.sin(angle)
    })
  }
}

export function layoutGraph(graph: Graph, options: LayoutOptions = {}): GraphLayout {
  const simNodes: SimNode[] = graph.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    label: node.label,
    band: BAND_FOR_KIND[node.kind],
  }))
  const nodeById = new Map(simNodes.map((node) => [node.id, node]))

  // Pin the self row at the origin so it stays the visual center.
  for (const node of simNodes) {
    if (node.kind === 'self') {
      node.fx = 0
      node.fy = 0
    }
  }

  // forceLink throws on an unknown endpoint, so only wire edges whose endpoints
  // are present nodes (this also preserves the "drop dangling edges" contract).
  const simLinks: SimLink[] = []
  for (const edge of graph.edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue
    const link: SimLink = { source: edge.source, target: edge.target, kind: edge.kind }
    if (edge.weight !== undefined) link.weight = edge.weight
    if (edge.interactionId !== undefined) link.interactionId = edge.interactionId
    simLinks.push(link)
  }

  seedPositions(simNodes)

  const simulation = forceSimulation(simNodes)
    .force(
      'link',
      forceLink<SimNode, SimLink>(simLinks)
        .id((node) => node.id)
        .distance((link) =>
          link.kind === 'interaction'
            ? LINK_DIST_INTERACTION / (1 + (link.weight ?? 1))
            : LINK_DIST_STRUCTURE,
        )
        .strength((link) =>
          link.kind === 'interaction'
            ? Math.min(1, INTERACTION_PULL * (link.weight ?? 1))
            : STRUCTURE_PULL,
        ),
    )
    .force('charge', forceManyBody().strength(CHARGE))
    .force('collide', forceCollide(COLLIDE_RADIUS))
    .force('radial', forceRadial<SimNode>((node) => BAND_RADIUS[node.band] ?? 0, 0, 0).strength(RADIAL_PULL))
    .stop()

  for (let i = 0; i < ITERATIONS; i += 1) simulation.tick()

  // Size the canvas around the settled extent, keeping the origin (self) centered.
  let maxAbsX = 0
  let maxAbsY = 0
  for (const node of simNodes) {
    maxAbsX = Math.max(maxAbsX, Math.abs(node.x ?? 0))
    maxAbsY = Math.max(maxAbsY, Math.abs(node.y ?? 0))
  }
  const width = Math.max(options.width ?? DEFAULT_WIDTH, 2 * (maxAbsX + OUTER_MARGIN))
  const height = Math.max(options.height ?? DEFAULT_HEIGHT, 2 * (maxAbsY + OUTER_MARGIN))
  const cx = width / 2
  const cy = height / 2

  const positioned = new Map<string, PositionedNode>()
  for (const node of simNodes) {
    positioned.set(node.id, {
      id: node.id,
      kind: node.kind,
      label: node.label,
      x: cx + (node.x ?? 0),
      y: cy + (node.y ?? 0),
      radius: node.kind === 'self' ? 13 : 7,
    })
  }

  // After ticking, forceLink has replaced each link's source/target with the
  // resolved node objects.
  const edges: PositionedEdge[] = []
  for (const link of simLinks) {
    const source = positioned.get((link.source as SimNode).id)
    const target = positioned.get((link.target as SimNode).id)
    if (!source || !target) continue
    const positionedEdge: PositionedEdge = { source, target, kind: link.kind }
    if (link.weight !== undefined) positionedEdge.weight = link.weight
    if (link.interactionId !== undefined) positionedEdge.interactionId = link.interactionId
    edges.push(positionedEdge)
  }

  return { width, height, nodes: [...positioned.values()], edges }
}
