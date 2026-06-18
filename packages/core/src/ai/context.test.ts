import { describe, expect, it } from 'vitest'
import type { RetrievedChunk } from '../retrieval/retrieve'
import { assembleAnswerContext, citedSubset } from './context'

function chunk(partial: Partial<RetrievedChunk> & { chunkId: string }): RetrievedChunk {
  return {
    text: 'body',
    snippet: 'body',
    recordType: 'document',
    recordId: 'doc1',
    recordTitle: 'Doc',
    chunkIndex: 0,
    score: 1,
    lexicalScore: 1,
    ...partial,
  }
}

describe('assembleAnswerContext', () => {
  it('numbers sources and maps each marker to a real chunk', () => {
    const chunks = [
      chunk({ chunkId: 'c1', text: 'Alex leads the Northwind project.' }),
      chunk({ chunkId: 'c2', recordType: 'interaction', recordId: 'int1', text: 'Met on Tuesday.' }),
    ]
    const { request, citations } = assembleAnswerContext('Who leads Northwind?', chunks)
    expect(citations).toHaveLength(2)
    expect(citations[0]).toMatchObject({ index: 1, chunkId: 'c1', recordType: 'document' })
    expect(citations[1]).toMatchObject({ index: 2, chunkId: 'c2', recordType: 'interaction' })
    // Only retrieved text reaches the prompt; the question is included.
    expect(request.messages[0]?.content).toContain('[1]')
    expect(request.messages[0]?.content).toContain('Alex leads the Northwind project.')
    expect(request.messages[0]?.content).toContain('Who leads Northwind?')
    expect(request.temperature).toBe(0)
  })

  it('handles an empty retrieval without inventing sources', () => {
    const { request, citations } = assembleAnswerContext('anything', [])
    expect(citations).toEqual([])
    expect(request.messages[0]?.content).toContain('No sources were retrieved')
  })

  it('truncates oversized chunks', () => {
    const big = chunk({ chunkId: 'c1', text: 'x'.repeat(5000) })
    const { request } = assembleAnswerContext('q', [big], { maxCharsPerChunk: 100 })
    expect(request.messages[0]?.content).toContain('…')
    expect(request.messages[0]?.content.length).toBeLessThan(1000)
  })
})

describe('citedSubset', () => {
  const citations = [
    { index: 1, chunkId: 'c1', recordType: 'document' as const, recordId: 'd', recordTitle: null },
    { index: 2, chunkId: 'c2', recordType: 'document' as const, recordId: 'd', recordTitle: null },
    { index: 3, chunkId: 'c3', recordType: 'document' as const, recordId: 'd', recordTitle: null },
  ]

  it('returns only the sources the answer actually cited, in first-use order', () => {
    const answer = 'Foo [2]. Bar [1][2]. Baz.'
    expect(citedSubset(answer, citations).map((c) => c.chunkId)).toEqual(['c2', 'c1'])
  })

  it('ignores citation markers with no matching source', () => {
    expect(citedSubset('out of range [9]', citations)).toEqual([])
  })

  it('returns nothing when the answer cites nothing', () => {
    expect(citedSubset('no markers here', citations)).toEqual([])
  })
})
