import { describe, expect, it } from 'vitest'
import { findDates, findEmails, selectChunks } from './preprocess'

describe('findDates', () => {
  it('finds ISO and long-form dates in order of appearance', () => {
    const text = 'Kickoff on 2026-06-17. Follow up by July 3, 2026 with the team.'
    expect(findDates(text).map((d) => d.value)).toEqual(['2026-06-17', 'July 3, 2026'])
  })

  it('returns an empty list when there are no dates', () => {
    expect(findDates('no dates here')).toEqual([])
  })
})

describe('findEmails', () => {
  it('extracts distinct lowercased emails', () => {
    const text = 'Email Alex@Northwind.com or alex@northwind.com, and dana@example.org.'
    expect(findEmails(text)).toEqual(['alex@northwind.com', 'dana@example.org'])
  })
})

describe('selectChunks', () => {
  const chunks = [
    { index: 2, text: 'c' },
    { index: 0, text: 'a' },
    { index: 1, text: 'b' },
  ]

  it('orders chunks by index', () => {
    expect(selectChunks(chunks).map((c) => c.text)).toEqual(['a', 'b', 'c'])
  })

  it('caps to the limit while preserving order', () => {
    expect(selectChunks(chunks, { limit: 2 }).map((c) => c.text)).toEqual(['a', 'b'])
  })
})
