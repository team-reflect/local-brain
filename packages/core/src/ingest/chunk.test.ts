import { describe, expect, it } from 'vitest'
import { chunkText, normalizeText } from './chunk'

describe('normalizeText', () => {
  it('normalizes newlines, trailing whitespace, and blank-line runs', () => {
    const input = 'line one  \r\n\r\n\r\n\r\nline two\t\n   '
    expect(normalizeText(input)).toBe('line one\n\nline two')
  })

  it('trims leading and trailing whitespace', () => {
    expect(normalizeText('   hi   ')).toBe('hi')
    expect(normalizeText('')).toBe('')
  })
})

describe('chunkText', () => {
  it('returns no chunks for empty/whitespace input', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('   \n  \n')).toEqual([])
  })

  it('keeps short text as a single chunk with index 0', () => {
    const chunks = chunkText('A short note.')
    expect(chunks).toEqual([{ index: 0, text: 'A short note.' }])
  })

  it('packs paragraphs greedily up to maxChars and indexes sequentially', () => {
    const text = 'aaaa\n\nbbbb\n\ncccc'
    const chunks = chunkText(text, { maxChars: 10 })
    // 'aaaa\n\nbbbb' is 10 chars (fits); 'cccc' starts a new chunk.
    expect(chunks).toEqual([
      { index: 0, text: 'aaaa\n\nbbbb' },
      { index: 1, text: 'cccc' },
    ])
  })

  it('hard-splits a single paragraph larger than maxChars', () => {
    const chunks = chunkText('x'.repeat(25), { maxChars: 10 })
    expect(chunks.map((chunk) => chunk.text.length)).toEqual([10, 10, 5])
    expect(chunks.map((chunk) => chunk.index)).toEqual([0, 1, 2])
  })
})
