import { describe, expect, it } from 'vitest'
import { deriveInteractionEdges, deriveMemoryEdges } from './getters'

describe('deriveInteractionEdges', () => {
  const personIds = new Set(['self', 'p1', 'p2', 'p3'])

  it('links a 1:1 interaction back to you', () => {
    const edges = deriveInteractionEdges(
      [{ id: 'i1' }],
      [{ interactionId: 'i1', personId: 'p1' }],
      personIds,
      'self',
    )
    expect(edges).toEqual([
      { source: 'p1', target: 'self', kind: 'interaction', weight: 1, interactionId: 'i1' },
    ])
  })

  it('links every attendee of a group interaction to one another', () => {
    const edges = deriveInteractionEdges(
      [{ id: 'i1' }],
      [
        { interactionId: 'i1', personId: 'p1' },
        { interactionId: 'i1', personId: 'p2' },
        { interactionId: 'i1', personId: 'p3' },
      ],
      personIds,
      'self',
    )
    expect(edges).toHaveLength(3)
    expect(edges.map((edge) => `${edge.source}-${edge.target}`).sort()).toEqual([
      'p1-p2',
      'p1-p3',
      'p2-p3',
    ])
    expect(edges.every((edge) => edge.weight === 1 && edge.kind === 'interaction')).toBe(true)
  })

  it('aggregates repeated contact into one weighted edge, keeping the most recent interaction', () => {
    // `interactions` is most-recent-first, so i1 outranks i3 as the representative.
    const edges = deriveInteractionEdges(
      [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }],
      [
        { interactionId: 'i3', personId: 'p1' },
        { interactionId: 'i3', personId: 'p2' },
        { interactionId: 'i1', personId: 'p1' },
        { interactionId: 'i1', personId: 'p2' },
      ],
      personIds,
      'self',
    )
    expect(edges).toEqual([
      { source: 'p1', target: 'p2', kind: 'interaction', weight: 2, interactionId: 'i1' },
    ])
  })

  it('skips archived/absent interactions, unknown people, and identity-less rows', () => {
    const edges = deriveInteractionEdges(
      [{ id: 'i1' }],
      [
        { interactionId: 'gone', personId: 'p1' }, // interaction not in scope
        { interactionId: 'i1', personId: 'ghost' }, // person is not a node
        { interactionId: 'i1', personId: null }, // no identity
      ],
      personIds,
      'self',
    )
    expect(edges).toEqual([])
  })

  it('drops a single-participant interaction when there is no self, or it is you', () => {
    expect(
      deriveInteractionEdges(
        [{ id: 'i1' }],
        [{ interactionId: 'i1', personId: 'p1' }],
        personIds,
        null,
      ),
    ).toEqual([])
    expect(
      deriveInteractionEdges(
        [{ id: 'i1' }],
        [{ interactionId: 'i1', personId: 'self' }],
        personIds,
        'self',
      ),
    ).toEqual([])
  })
})

describe('deriveMemoryEdges', () => {
  it('keeps direct memory links to visible nodes', () => {
    const edges = deriveMemoryEdges(
      [{ memoryId: 'm1', recordType: 'person', recordId: 'p1' }],
      new Set(['m1', 'p1']),
      new Map(),
      new Set(),
      'self',
    )
    expect(edges).toEqual([{ source: 'm1', target: 'p1', kind: 'memory' }])
  })

  it('dissolves interaction memory links through visible participants', () => {
    const edges = deriveMemoryEdges(
      [{ memoryId: 'm1', recordType: 'interaction', recordId: 'i1' }],
      new Set(['m1', 'p1', 'p2']),
      new Map([['i1', new Set(['p1', 'p2', 'ghost'])]]),
      new Set(['i1']),
      'self',
    )
    expect(edges).toEqual([
      { source: 'm1', target: 'p1', kind: 'memory' },
      { source: 'm1', target: 'p2', kind: 'memory' },
    ])
  })

  it('falls back to self for interaction memory links without visible participants', () => {
    const edges = deriveMemoryEdges(
      [{ memoryId: 'm1', recordType: 'interaction', recordId: 'i1' }],
      new Set(['m1', 'self']),
      new Map(),
      new Set(['i1']),
      'self',
    )
    expect(edges).toEqual([{ source: 'm1', target: 'self', kind: 'memory' }])
  })

  it('skips interaction memory links for archived or absent interactions', () => {
    const edges = deriveMemoryEdges(
      [{ memoryId: 'm1', recordType: 'interaction', recordId: 'gone' }],
      new Set(['m1', 'self']),
      new Map(),
      new Set(['i1']),
      'self',
    )
    expect(edges).toEqual([])
  })
})
