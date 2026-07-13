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

  it('normalizes canonical statuses and rejects unsupported values', () => {
    expect(validateNewTask({ title: 'Ship it', status: ' IN_PROGRESS ' }).status).toBe('in_progress')
    expect(() => validateNewTask({ title: 'Ship it', status: 'scheduled' })).toThrow(ValidationError)
  })
})

describe('validateTaskPatch', () => {
  it('leaves a status-only patch untouched', () => {
    expect(validateTaskPatch({ status: 'done' })).toEqual({ status: 'done' })
  })

  it('normalizes editable text fields', () => {
    expect(validateTaskPatch({ title: '  Ship  it ', description: '  Bring the deck  ' })).toEqual({
      title: 'Ship it',
      description: 'Bring the deck',
    })
    expect(validateTaskPatch({ description: '   ' })).toEqual({ description: null })
  })

  it('rejects unsupported status patches', () => {
    expect(() => validateTaskPatch({ status: 'canceled' })).toThrow(ValidationError)
  })
})
