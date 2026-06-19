import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../validation'
import { validateNewOrganization } from './validators'

describe('validateNewOrganization', () => {
  it('requires a name and normalizes the domain', () => {
    const out = validateNewOrganization({ name: ' Acme  Inc ', domain: 'https://www.Acme.com/jobs' })
    expect(out.name).toBe('Acme Inc')
    expect(out.domain).toBe('acme.com')
  })

  it('rejects a blank name', () => {
    expect(() => validateNewOrganization({ name: '  ' })).toThrow(ValidationError)
  })
})
