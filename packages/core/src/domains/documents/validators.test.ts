import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../validation'
import { validateNewDocument, validateDocumentPatch } from './validators'

describe('validateNewDocument', () => {
  it('canonicalizes the body and keeps a title-only document', () => {
    const out = validateNewDocument({ title: '  Field note ', bodyText: 'Para one.\r\n\r\n\r\nPara two.   ' })
    expect(out.title).toBe('Field note')
    expect(out.bodyText).toBe('Para one.\n\nPara two.')
  })

  it('accepts a title with no body', () => {
    const out = validateNewDocument({ title: 'Just a title' })
    expect(out.title).toBe('Just a title')
    expect(out.bodyText).toBeNull()
  })

  it('rejects a document with neither title nor body', () => {
    expect(() => validateNewDocument({ title: '   ', bodyText: '  \n ' })).toThrow(ValidationError)
    expect(() => validateNewDocument({})).toThrow(ValidationError)
  })
})

describe('validateDocumentPatch', () => {
  it('normalizes only the provided fields without the cross-field rule', () => {
    const out = validateDocumentPatch({ summary: '  short  ' })
    expect(out).toEqual({ summary: 'short' })
  })
})
