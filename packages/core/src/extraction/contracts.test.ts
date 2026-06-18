import { describe, expect, it } from 'vitest'
import { parseExtractionResult, validateExtraction } from './contracts'

describe('parseExtractionResult', () => {
  it('applies array defaults and normalizes nullish fields', () => {
    const result = parseExtractionResult({
      people: [{ ref: 'p1', fullName: 'Alex Rivera' }],
    })
    expect(result.organizations).toEqual([])
    expect(result.memories).toEqual([])
    expect(result.people[0]?.fullName).toBe('Alex Rivera')
  })

  it('defaults memory kind to fact and arrays to empty', () => {
    const result = parseExtractionResult({
      memories: [{ claim: 'Alex founded Northwind.' }],
    })
    expect(result.memories[0]?.kind).toBe('fact')
    expect(result.memories[0]?.subjects).toEqual([])
    expect(result.memories[0]?.evidence).toEqual([])
  })

  it('rejects an unknown memory kind', () => {
    expect(() => parseExtractionResult({ memories: [{ kind: 'gossip', claim: 'x' }] })).toThrow()
  })
})

describe('validateExtraction', () => {
  it('accepts a referentially sound graph', () => {
    const result = parseExtractionResult({
      people: [{ ref: 'p1', fullName: 'Alex' }],
      organizations: [{ ref: 'o1', name: 'Northwind' }],
      affiliations: [{ personRef: 'p1', organizationRef: 'o1' }],
      tasks: [{ ref: 't1', title: 'Ship', personRefs: ['p1'], projectRef: undefined }],
      memories: [{ claim: 'c', subjects: [{ ref: 'p1' }] }],
    })
    expect(validateExtraction(result)).toEqual([])
  })

  it('flags duplicate refs across entity types', () => {
    const result = parseExtractionResult({
      people: [{ ref: 'x', fullName: 'Alex' }],
      organizations: [{ ref: 'x', name: 'Northwind' }],
    })
    expect(validateExtraction(result).join(' ')).toContain('duplicate ref "x"')
  })

  it('flags unknown and mistyped references', () => {
    const result = parseExtractionResult({
      people: [{ ref: 'p1', fullName: 'Alex' }],
      affiliations: [{ personRef: 'p1', organizationRef: 'missing' }],
      tasks: [{ ref: 't1', title: 'Ship', personRefs: ['p1'], projectRef: 'p1' }],
    })
    const problems = validateExtraction(result).join(' ')
    expect(problems).toContain('unknown ref "missing"')
    // projectRef points at a person ref -> type mismatch.
    expect(problems).toContain('expected a project ref')
  })
})
