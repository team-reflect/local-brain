import { describe, expect, it } from 'vitest'
import { combineScore, lexicalScore, recencyScore } from './ranking'

describe('lexicalScore', () => {
  it('maps bm25 (more-negative is better) to a positive bounded score', () => {
    expect(lexicalScore(0)).toBe(0)
    expect(lexicalScore(-4)).toBeCloseTo(0.5, 5)
    expect(lexicalScore(-100)).toBeGreaterThan(0.9)
  })

  it('clamps positive bm25 to zero', () => {
    expect(lexicalScore(5)).toBe(0)
  })
})

describe('recencyScore', () => {
  const now = new Date('2026-06-17T00:00:00Z')

  it('is ~1 for today and halves every half-life', () => {
    expect(recencyScore('2026-06-17T00:00:00Z', now)).toBeCloseTo(1, 5)
    expect(recencyScore('2026-03-19T00:00:00Z', now)).toBeCloseTo(0.5, 1) // ~90 days
  })

  it('falls back to a neutral-old score for missing/invalid dates', () => {
    expect(recencyScore(null, now)).toBe(0.25)
    expect(recencyScore('not-a-date', now)).toBe(0.25)
  })
})

describe('combineScore', () => {
  it('weights lexical above recency', () => {
    const lexHeavy = combineScore({ lexical: 1, recency: 0 })
    const recHeavy = combineScore({ lexical: 0, recency: 1 })
    expect(lexHeavy).toBeGreaterThan(recHeavy)
  })

  it('a link boost only ever helps a relevant hit', () => {
    const plain = combineScore({ lexical: 0.5, recency: 0.5 })
    const boosted = combineScore({ lexical: 0.5, recency: 0.5, linked: true })
    expect(boosted).toBeGreaterThan(plain)
    expect(combineScore({ lexical: 0, recency: 0, linked: true })).toBe(0)
  })
})
