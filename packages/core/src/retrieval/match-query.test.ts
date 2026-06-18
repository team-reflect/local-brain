import { describe, expect, it } from 'vitest'
import { toLikePattern, toMatchQuery } from './match-query'

describe('toMatchQuery', () => {
  it('tokenizes to alphanumerics and prefix-matches the last token', () => {
    expect(toMatchQuery('quarterly planning')).toBe('quarterly planning*')
  })

  it('neutralizes FTS operators in user input', () => {
    // Quotes, NEAR, OR, parentheses, hyphens must not survive as operators.
    expect(toMatchQuery('"drop table" OR (x)')).toBe('drop table or x*')
  })

  it('returns null for input with no searchable tokens', () => {
    expect(toMatchQuery('   ')).toBeNull()
    expect(toMatchQuery('***')).toBeNull()
  })

  it('can disable the trailing prefix', () => {
    expect(toMatchQuery('alex northwind', { prefixLast: false })).toBe('alex northwind')
  })

  it('supports OR recall for question-style queries', () => {
    expect(toMatchQuery('who founded northwind', { op: 'or' })).toBe('who OR founded OR northwind*')
  })

  it('handles unicode word characters', () => {
    expect(toMatchQuery('café münchen')).toBe('café münchen*')
  })
})

describe('toLikePattern', () => {
  it('wraps in wildcards and escapes LIKE metacharacters', () => {
    expect(toLikePattern('50%_off')).toBe('%50\\%\\_off%')
  })

  it('returns null for blank input', () => {
    expect(toLikePattern('  ')).toBeNull()
  })
})
