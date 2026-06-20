import { describe, expect, it } from 'vitest'
import type { Graph } from '@local-brain/core'
import { layoutGraph } from './graph-layout'

const GRAPH: Graph = {
  selfId: 'self',
  nodes: [
    { id: 'self', kind: 'self', label: 'You' },
    { id: 'p1', kind: 'person', label: 'Alex' },
    { id: 'p2', kind: 'person', label: 'Jordan' },
    { id: 'proj', kind: 'project', label: 'Partnership' },
    { id: 'org', kind: 'organization', label: 'Northwind' },
  ],
  edges: [
    { source: 'self', target: 'p1', kind: 'knows' },
    { source: 'self', target: 'proj', kind: 'owns' },
    { source: 'p1', target: 'org', kind: 'affiliation' },
    // An edge to a node that isn't present must be dropped.
    { source: 'self', target: 'ghost', kind: 'knows' },
  ],
}

describe('layoutGraph', () => {
  it('places the self node at the exact center', () => {
    const layout = layoutGraph(GRAPH, { width: 800, height: 600 })
    const self = layout.nodes.find((node) => node.kind === 'self')
    expect(self).toBeDefined()
    expect(self?.x).toBe(400)
    expect(self?.y).toBe(300)
    expect(self?.radius).toBeGreaterThan(7)
  })

  it('positions every node and is deterministic', () => {
    const a = layoutGraph(GRAPH)
    const b = layoutGraph(GRAPH)
    expect(a.nodes).toHaveLength(5)
    expect(a.nodes).toEqual(b.nodes)
    // No NaNs leaked from the trig.
    expect(a.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true)
  })

  it('keeps only edges whose endpoints are present nodes', () => {
    const layout = layoutGraph(GRAPH)
    expect(layout.edges).toHaveLength(3)
    expect(layout.edges.some((edge) => edge.target.id === 'ghost')).toBe(false)
    // Edge endpoints resolve to positioned nodes.
    expect(layout.edges.every((edge) => 'x' in edge.source && 'x' in edge.target)).toBe(true)
  })

  it('places people at distinct, non-overlapping positions', () => {
    const layout = layoutGraph(GRAPH)
    const people = layout.nodes.filter((node) => node.kind === 'person')
    expect(people).toHaveLength(2)
    const [a, b] = people
    expect(a?.x === b?.x && a?.y === b?.y).toBe(false)
    // The collision force keeps them measurably apart.
    expect(Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0))).toBeGreaterThan(10)
  })

  it('pulls people who share interactions closer than unconnected people', () => {
    const graph: Graph = {
      selfId: 'self',
      nodes: [
        { id: 'self', kind: 'self', label: 'You' },
        { id: 'a', kind: 'person', label: 'A' },
        { id: 'b', kind: 'person', label: 'B' },
        { id: 'c', kind: 'person', label: 'C' },
      ],
      edges: [
        { source: 'self', target: 'a', kind: 'knows' },
        { source: 'self', target: 'b', kind: 'knows' },
        { source: 'self', target: 'c', kind: 'knows' },
        // A and B interact often; C interacts with neither.
        { source: 'a', target: 'b', kind: 'interaction', weight: 5, interactionId: 'i1' },
      ],
    }
    const byId = new Map(layoutGraph(graph).nodes.map((node) => [node.id, node]))
    const dist = (p: string, q: string): number => {
      const a = byId.get(p)
      const b = byId.get(q)
      return Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0))
    }
    expect(dist('a', 'b')).toBeLessThan(dist('a', 'c'))
  })

  it('handles a self-only graph without NaNs and keeps self centered', () => {
    const layout = layoutGraph({
      selfId: 'self',
      nodes: [{ id: 'self', kind: 'self', label: 'You' }],
      edges: [],
    })
    expect(layout.nodes).toHaveLength(1)
    const self = layout.nodes[0]
    expect(Number.isFinite(self?.x) && Number.isFinite(self?.y)).toBe(true)
    expect(layout.width).toBe(880)
    expect(layout.height).toBe(760)
    expect(self?.x).toBe(440)
    expect(self?.y).toBe(380)
  })

  it('carries interaction weight and target through to positioned edges', () => {
    const graph: Graph = {
      selfId: 'self',
      nodes: [
        { id: 'self', kind: 'self', label: 'You' },
        { id: 'p1', kind: 'person', label: 'Alex' },
      ],
      edges: [{ source: 'self', target: 'p1', kind: 'interaction', weight: 4, interactionId: 'int9' }],
    }
    const edge = layoutGraph(graph).edges.find((candidate) => candidate.kind === 'interaction')
    expect(edge?.weight).toBe(4)
    expect(edge?.interactionId).toBe('int9')
  })

  it('expands the canvas instead of dropping dense node sets', () => {
    const graph: Graph = {
      selfId: 'self',
      nodes: [
        { id: 'self', kind: 'self', label: 'You' },
        ...Array.from({ length: 420 }, (_, index) => ({
          id: `person-${index}`,
          kind: 'person' as const,
          label: `Person ${index}`,
        })),
      ],
      edges: [],
    }

    const layout = layoutGraph(graph)

    expect(layout.nodes).toHaveLength(graph.nodes.length)
    expect(layout.width).toBeGreaterThan(880)
    expect(layout.height).toBeGreaterThan(760)
  })
})
