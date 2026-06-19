import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../validation'
import { validateNewPerson, validatePersonPatch } from './validators'

describe('validateNewPerson', () => {
  it('squishes the name and normalizes the email', () => {
    const out = validateNewPerson({ fullName: '  Ada   Lovelace ', primaryEmail: ' Ada@Example.COM ' })
    expect(out.fullName).toBe('Ada Lovelace')
    expect(out.primaryEmail).toBe('ada@example.com')
  })

  it('rejects a blank full name', () => {
    expect(() => validateNewPerson({ fullName: '   ' })).toThrow(ValidationError)
  })

  it('collapses blank optional fields to null and leaves unrelated fields intact', () => {
    const out = validateNewPerson({ fullName: 'Ada', headline: '  ', isSelf: 1 })
    expect(out.headline).toBeNull()
    expect(out.isSelf).toBe(1)
  })
})

describe('validatePersonPatch', () => {
  it('only touches provided fields', () => {
    const out = validatePersonPatch({ primaryEmail: 'A@B.COM' })
    expect(out).toEqual({ primaryEmail: 'a@b.com' })
  })

  it('rejects clearing the name to blank', () => {
    expect(() => validatePersonPatch({ fullName: '' })).toThrow(ValidationError)
  })
})
