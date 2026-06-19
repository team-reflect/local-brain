import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../validation'
import { validateNewInteraction } from './validators'

describe('validateNewInteraction', () => {
  it('keeps a titled interaction with no body and leaves kind untouched', () => {
    const out = validateNewInteraction({ kind: 'meeting', title: '  Pairing session ' })
    expect(out.title).toBe('Pairing session')
    expect(out.bodyText).toBeNull()
    expect(out.kind).toBe('meeting')
  })

  it('rejects an interaction with neither title nor body', () => {
    expect(() => validateNewInteraction({ kind: 'note' })).toThrow(ValidationError)
  })
})
