import { describe, expect, it } from 'vitest'
import {
  matchOrganization,
  matchPerson,
  matchProject,
  normalizeDomain,
  normalizeEmail,
  normalizeName,
} from './match'

describe('normalizeName', () => {
  it('lowercases, collapses whitespace, and drops punctuation', () => {
    expect(normalizeName('  Alex   Rivera  ')).toBe('alex rivera')
    expect(normalizeName('Dr. Jane O’Brien')).toBe('dr jane o brien')
  })

  it('strips diacritics so accented names match', () => {
    expect(normalizeName('Renée Müller')).toBe(normalizeName('Renee Muller'))
  })
})

describe('normalizeEmail / normalizeDomain', () => {
  it('normalizes emails', () => {
    expect(normalizeEmail('  Alex@Example.COM ')).toBe('alex@example.com')
    expect(normalizeEmail('')).toBeNull()
    expect(normalizeEmail(null)).toBeNull()
  })

  it('strips scheme, www, and path from domains', () => {
    expect(normalizeDomain('https://www.Northwind.com/about')).toBe('northwind.com')
    expect(normalizeDomain('Northwind.com')).toBe('northwind.com')
    expect(normalizeDomain(undefined)).toBeNull()
  })
})

describe('matchPerson', () => {
  const candidates = [
    { id: 'p1', fullName: 'Alex Rivera', primaryEmail: 'alex@northwind.com' },
    { id: 'p2', fullName: 'Dana Scully', primaryEmail: null },
  ]

  it('prefers an exact email match over name', () => {
    expect(matchPerson({ fullName: 'A. Rivera', primaryEmail: 'ALEX@northwind.com' }, candidates)).toBe('p1')
  })

  it('falls back to a normalized name match', () => {
    expect(matchPerson({ fullName: 'dana  scully', primaryEmail: null }, candidates)).toBe('p2')
  })

  it('returns null when nothing matches', () => {
    expect(matchPerson({ fullName: 'Fox Mulder', primaryEmail: 'fox@fbi.gov' }, candidates)).toBeNull()
  })
})

describe('matchOrganization', () => {
  const candidates = [
    { id: 'o1', name: 'Northwind Labs', domain: 'northwind.com' },
    { id: 'o2', name: 'Acme', domain: null },
  ]

  it('matches by domain first', () => {
    expect(matchOrganization({ name: 'Northwind', domain: 'www.northwind.com' }, candidates)).toBe('o1')
  })

  it('matches by normalized name when no domain', () => {
    expect(matchOrganization({ name: 'acme', domain: null }, candidates)).toBe('o2')
  })

  it('returns null when nothing matches', () => {
    expect(matchOrganization({ name: 'Globex', domain: 'globex.io' }, candidates)).toBeNull()
  })
})

describe('matchProject', () => {
  it('matches by normalized name', () => {
    const candidates = [{ id: 'pr1', name: 'Northwind Partnership' }]
    expect(matchProject({ name: 'northwind   partnership' }, candidates)).toBe('pr1')
    expect(matchProject({ name: 'Other' }, candidates)).toBeNull()
  })
})
