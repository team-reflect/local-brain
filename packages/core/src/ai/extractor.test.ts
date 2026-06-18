import { describe, expect, it } from 'vitest'
import { extractJsonObject } from './extractor'

describe('extractJsonObject', () => {
  it('parses a bare JSON object', () => {
    expect(extractJsonObject('{"people":[]}')).toEqual({ people: [] })
  })

  it('pulls the object out of code fences and surrounding prose', () => {
    const text = 'Here you go:\n```json\n{"memories":[{"claim":"x"}]}\n```\nDone.'
    expect(extractJsonObject(text)).toEqual({ memories: [{ claim: 'x' }] })
  })

  it('respects braces inside strings', () => {
    expect(extractJsonObject('{"claim":"a } b { c"}')).toEqual({ claim: 'a } b { c' })
  })

  it('throws when there is no object', () => {
    expect(() => extractJsonObject('no json here')).toThrow(/no JSON object/)
  })

  it('throws on an unterminated object', () => {
    expect(() => extractJsonObject('{"a":1')).toThrow(/unterminated/)
  })
})
