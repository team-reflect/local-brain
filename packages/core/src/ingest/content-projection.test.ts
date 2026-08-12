import { describe, expect, it } from 'vitest'
import { planExactChunkCompaction } from './content-projection'

describe('planExactChunkCompaction', () => {
  it('keeps earliest exact chunks, preserves ids, and closes duplicate holes', () => {
    const plan = planExactChunkCompaction([
      { id: 'chunk-c', chunkIndex: 3, text: 'third', contentHash: 'c' },
      { id: 'chunk-a-copy', chunkIndex: 2, text: 'first', contentHash: 'a' },
      { id: 'chunk-b', chunkIndex: 1, text: 'second', contentHash: 'b' },
      { id: 'chunk-a', chunkIndex: 0, text: 'first', contentHash: 'a' },
    ])

    expect(plan.duplicates).toEqual([
      { duplicateId: 'chunk-a-copy', canonicalId: 'chunk-a' },
    ])
    expect(plan.survivors.map(({ id, originalChunkIndex, chunkIndex }) => ({
      id,
      originalChunkIndex,
      chunkIndex,
    }))).toEqual([
      { id: 'chunk-a', originalChunkIndex: 0, chunkIndex: 0 },
      { id: 'chunk-b', originalChunkIndex: 1, chunkIndex: 1 },
      { id: 'chunk-c', originalChunkIndex: 3, chunkIndex: 2 },
    ])
  })

  it('is byte-exact and safely closes pre-existing index holes', () => {
    const plan = planExactChunkCompaction([
      { id: 'upper', chunkIndex: 4, text: 'Quoted', contentHash: null },
      { id: 'lower', chunkIndex: 7, text: 'quoted', contentHash: null },
    ])

    expect(plan.duplicates).toEqual([])
    expect(plan.survivors.map((chunk) => chunk.chunkIndex)).toEqual([0, 1])
  })
})
