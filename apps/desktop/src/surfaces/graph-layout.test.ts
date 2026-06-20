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

  it('spreads people on the same ring to distinct angles', () => {
    const layout = layoutGraph(GRAPH)
    const people = layout.nodes.filter((node) => node.kind === 'person')
    expect(people).toHaveLength(2)
    expect(people[0]?.x === people[1]?.x && people[0]?.y === people[1]?.y).toBe(false)
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
