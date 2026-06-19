import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../validation'
import { validateNewTask, validateTaskPatch } from './validators'

describe('validateNewTask', () => {
  it('squishes the title and preserves other fields', () => {
    const out = validateNewTask({ title: '  Ship  it ', status: 'open' })
    expect(out.title).toBe('Ship it')
    expect(out.status).toBe('open')
  })

  it('rejects a blank title', () => {
    expect(() => validateNewTask({ title: '   ' })).toThrow(ValidationError)
  })
})

describe('validateTaskPatch', () => {
  it('leaves a status-only patch untouched', () => {
    expect(validateTaskPatch({ status: 'done' })).toEqual({ status: 'done' })
  })
})
