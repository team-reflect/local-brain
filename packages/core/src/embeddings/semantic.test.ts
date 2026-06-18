import { afterEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import type { RetrievedChunk } from '../retrieval/retrieve'
import { fuseRanked, semanticHits, MAX_COSINE_DISTANCE } from './semantic'

function hit(chunkId: string, overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chunkId,
    text: `text ${chunkId}`,
    snippet: `snippet ${chunkId}`,
    recordType: 'document',
    recordId: `r-${chunkId}`,
    recordTitle: null,
    chunkIndex: 0,
    score: 0,
    lexicalScore: 0,
    ...overrides,
  }
}

describe('fuseRanked (RRF)', () => {
  it('ranks an item that places well in both lists above single-list items', () => {
    const lexical = [hit('a', { lexicalScore: 0.9 }), hit('b'), hit('c')]
    const semantic = [hit('a', { semanticScore: 0.8 }), hit('d'), hit('e')]
    const fused = fuseRanked([lexical, semantic], 5)
    expect(fused[0]?.chunkId).toBe('a') // top of both → highest fused score
    expect(fused.map((h) => h.chunkId)).toContain('b')
    expect(fused.map((h) => h.chunkId)).toContain('d')
  })

  it('dedupes by chunkId and keeps the lexical snippet and best per-source scores', () => {
    const lexical = [hit('a', { lexicalScore: 0.7, snippet: 'lex [match]' })]
    const semantic = [hit('a', { semanticScore: 0.6, snippet: 'semantic preview' })]
    const fused = fuseRanked([lexical, semantic], 5)
    expect(fused).toHaveLength(1)
    expect(fused[0]?.snippet).toBe('lex [match]')
    expect(fused[0]?.lexicalScore).toBe(0.7)
    expect(fused[0]?.semanticScore).toBe(0.6)
  })

  it('is deterministic and respects the limit', () => {
    const list = [hit('a'), hit('b'), hit('c'), hit('d')]
    const once = fuseRanked([list], 2)
    const twice = fuseRanked([list], 2)
    expect(once).toHaveLength(2)
    expect(once.map((h) => h.chunkId)).toEqual(twice.map((h) => h.chunkId))
  })
})

describe('semanticHits', () => {
  afterEach(() => setBridge({ invoke: () => Promise.reject(new Error('no bridge')) }))

  it('maps KNN rows to chunks, drops noise past the cosine cutoff, and scores 1 − distance', async () => {
    setBridge({
      invoke: (command) => {
        if (command !== 'db_query') return Promise.reject(new Error(`unexpected ${command}`))
        return Promise.resolve([
          { chunkId: 'near', text: 'near text', recordType: 'document', recordId: 'r1', chunkIndex: 0, recordTitle: 'Doc', distance: 0.1 },
          { chunkId: 'mid', text: 'mid text', recordType: 'interaction', recordId: 'r2', chunkIndex: 1, recordTitle: null, distance: 0.5 },
          { chunkId: 'far', text: 'far text', recordType: 'document', recordId: 'r3', chunkIndex: 0, recordTitle: null, distance: MAX_COSINE_DISTANCE + 0.05 },
        ])
      },
    })
    const hits = await semanticHits([0.1, 0.2], { limit: 10 })
    expect(hits.map((h) => h.chunkId)).toEqual(['near', 'mid'])
    expect(hits[0]?.score).toBeCloseTo(0.9)
    expect(hits[0]?.semanticScore).toBeCloseTo(0.9)
    expect(hits[1]?.score).toBeCloseTo(0.5)
  })
})
