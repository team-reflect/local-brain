import { describe, expect, it } from 'vitest'
import { normalizeDomain, normalizeEmail, normalizeName, squish, trimToNull } from './normalize'

describe('squish', () => {
  it('collapses internal whitespace and trims, preserving case', () => {
    expect(squish('  Ada   Lovelace \n')).toBe('Ada Lovelace')
    expect(squish('ALL CAPS')).toBe('ALL CAPS')
  })

  it('returns an empty string for all-whitespace input', () => {
    expect(squish('   \t\n ')).toBe('')
  })
})

describe('trimToNull', () => {
  it('trims, and collapses empty/whitespace/nullish to null', () => {
    expect(trimToNull('  hi  ')).toBe('hi')
    expect(trimToNull('   ')).toBeNull()
    expect(trimToNull('')).toBeNull()
    expect(trimToNull(null)).toBeNull()
    expect(trimToNull(undefined)).toBeNull()
  })
})

describe('normalizeEmail', () => {
  it('lowercases and trims, collapsing blank to null', () => {
    expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com')
    expect(normalizeEmail('   ')).toBeNull()
    expect(normalizeEmail(null)).toBeNull()
  })
})

describe('normalizeDomain', () => {
  it('strips scheme, www, path, and lowercases', () => {
    expect(normalizeDomain('https://www.Acme.com/careers')).toBe('acme.com')
    expect(normalizeDomain('ACME.com')).toBe('acme.com')
    expect(normalizeDomain('   ')).toBeNull()
  })
})

describe('normalizeName', () => {
  it('folds case, diacritics and punctuation for comparison keys', () => {
    expect(normalizeName('Ådá  Lovelace!')).toBe('ada lovelace')
    expect(normalizeName('  ')).toBe('')
  })
})
