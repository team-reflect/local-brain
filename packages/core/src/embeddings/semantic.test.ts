import { afterEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import type { RetrievedChunk } from '../retrieval/retrieve'
import { EMBEDDING_MODEL_ID } from './model'
import { fuseRanked, semanticHits, MAX_COSINE_DISTANCE } from './semantic'

function hit(chunkId: string, overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chunkId,
    text: `text ${chunkId}`,
    snippet: `snippet ${chunkId}`,
    recordType: 'document',
    recordId: `r-${chunkId}`,
    recordTitle: null,
    recordDate: null,
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

  it('restricts KNN joins to the current model and current chunk hash', async () => {
    // A real vec0 KNN can't run under Node's SQLite (see pipeline.test.mjs), so
    // assert the contract at the query level: the chunk_embeddings join must pin
    // model_id so vectors from an older model can't rank in after a model change.
    let captured: { sql: string; params: unknown[] } | undefined
    setBridge({
      invoke: (command, args) => {
        if (command !== 'db_query') return Promise.reject(new Error(`unexpected ${command}`))
        captured = args as { sql: string; params: unknown[] }
        return Promise.resolve([])
      },
    })
    await semanticHits([0.1, 0.2], { limit: 10 })
    expect(captured?.sql).toMatch(/ce\.model_id\s*=/)
    expect(captured?.sql).toMatch(/cc\.content_hash\s*=\s*ce\.content_hash/)
    expect(captured?.params).toContain(EMBEDDING_MODEL_ID)
  })

  it('over-fetches vec neighbours before applying typed filters and the final limit', async () => {
    let captured: { sql: string; params: unknown[] } | undefined
    setBridge({
      invoke: (command, args) => {
        if (command !== 'db_query') return Promise.reject(new Error(`unexpected ${command}`))
        captured = args as { sql: string; params: unknown[] }
        return Promise.resolve([])
      },
    })

    await semanticHits([0.1, 0.2], { limit: 10, filters: { recordTypes: ['document'] } })

    expect(captured?.params).toContain(40)
    expect(captured?.params).toContain('document')
  })

  it('expands a record-diverse search when the first KNN pool is dominated', async () => {
    const requested: number[] = []
    setBridge({
      invoke: (command, args) => {
        if (command !== 'db_query') return Promise.reject(new Error(`unexpected ${command}`))
        const params = (args as { params: unknown[] }).params
        const k = params.find((value): value is number => typeof value === 'number') ?? 0
        requested.push(k)
        const diverse = k >= 80
        return Promise.resolve(Array.from({ length: 10 }, (_, index) => ({
          chunkId: `chunk-${index}`,
          text: `text ${index}`,
          recordType: 'document',
          recordId: diverse ? `record-${index}` : 'one-long-record',
          chunkIndex: index,
          recordTitle: null,
          recordDate: null,
          distance: 0.2,
        })))
      },
    })

    const hits = await semanticHits([0.1, 0.2], {
      limit: 10,
      minUniqueRecords: 5,
      maxChunksPerRecord: 2,
    })

    expect(requested).toEqual([40, 80])
    expect(new Set(hits.map((item) => item.recordId)).size).toBe(10)
  })

  it('counts unique content rather than duplicate neighbors toward the per-record cap', async () => {
    setBridge({
      invoke: (command) => {
        if (command !== 'db_query') return Promise.reject(new Error(`unexpected ${command}`))
        return Promise.resolve([
          ...Array.from({ length: 16 }, (_, index) => ({
            chunkId: `quoted-${index}`,
            text: 'Repeated quoted mortgage history.',
            contentHash: 'quoted-history-hash',
            recordType: 'interaction',
            recordId: 'mortgage-thread',
            chunkIndex: index,
            recordTitle: 'Mortgage email',
            recordDate: null,
            distance: 0.1 + index * 0.001,
          })),
          ...Array.from({ length: 3 }, (_, index) => ({
            chunkId: `quoted-variant-${index}`,
            text: `  REPEATED${' '.repeat(index + 2)}quoted\nmortgage history.  `,
            contentHash: `quoted-variant-hash-${index}`,
            recordType: 'interaction',
            recordId: 'mortgage-thread',
            chunkIndex: 16 + index,
            recordTitle: 'Mortgage email',
            recordDate: null,
            distance: 0.12 + index * 0.001,
          })),
          {
            chunkId: 'answer',
            text: 'The mortgage interest rate is 5.125%.',
            contentHash: 'answer-hash',
            recordType: 'interaction',
            recordId: 'mortgage-thread',
            chunkIndex: 19,
            recordTitle: 'Mortgage email',
            recordDate: null,
            distance: 0.2,
          },
        ])
      },
    })

    const hits = await semanticHits([0.1, 0.2], {
      limit: 2,
      minUniqueRecords: 1,
      maxChunksPerRecord: 2,
    })

    expect(hits.map((item) => item.chunkId)).toEqual(['quoted-0', 'answer'])
    expect(hits[1]?.text).toContain('5.125%')
    expect(hits[0]).not.toHaveProperty('contentHash')
  })

  it('preserves broad record diversity when nearest chunks are front-loaded by long records', async () => {
    setBridge({
      invoke: (command) => {
        if (command !== 'db_query') return Promise.reject(new Error(`unexpected ${command}`))
        const frontLoaded = Array.from({ length: 32 }, (_, recordIndex) =>
          Array.from({ length: 4 }, (_, chunkIndex) => ({
            chunkId: `long-${recordIndex}-${chunkIndex}`,
            text: `unique long text ${recordIndex} ${chunkIndex}`,
            contentHash: `long-hash-${recordIndex}-${chunkIndex}`,
            recordType: 'document',
            recordId: `record-${recordIndex}`,
            chunkIndex,
            recordTitle: null,
            recordDate: null,
            distance: 0.1 + (recordIndex * 4 + chunkIndex) * 0.001,
          })),
        ).flat()
        const remaining = Array.from({ length: 16 }, (_, index) => ({
          chunkId: `short-${index + 32}`,
          text: `unique short text ${index + 32}`,
          contentHash: `short-hash-${index + 32}`,
          recordType: 'document',
          recordId: `record-${index + 32}`,
          chunkIndex: 0,
          recordTitle: null,
          recordDate: null,
          distance: 0.3 + index * 0.001,
        }))
        return Promise.resolve([...frontLoaded, ...remaining])
      },
    })

    const hits = await semanticHits([0.1, 0.2], {
      limit: 96,
      minUniqueRecords: 48,
      maxChunksPerRecord: 4,
    })

    expect(new Set(hits.map((item) => item.recordId))).toHaveLength(48)
    expect(hits).toHaveLength(96)
    for (let recordIndex = 32; recordIndex < 48; recordIndex += 1) {
      expect(hits.some((item) => item.recordId === `record-${recordIndex}`)).toBe(true)
    }
  })
})
