import { normalizeText } from '../../ingest/chunk'
import { squish, trimToNull } from '../../text/normalize'
import { ValidationError } from '../../validation'
import type { NewDocument, DocumentPatch } from './setters'

/**
 * Normalize and validate a document write. The SQLite schema makes both `title`
 * and `body_text` nullable, so a totally empty document would pass — this rejects
 * one with neither a title nor body, since it would be unreadable and
 * unsearchable.
 */
export function validateNewDocument(input: NewDocument): NewDocument {
  const clean = validateDocumentPatch(input)
  const title = clean.title ?? null
  const bodyText = clean.bodyText ?? null
  if (!title && !bodyText) {
    throw new ValidationError('a document needs a title or body text')
  }
  return { ...clean, title, bodyText }
}

export function validateDocumentPatch(patch: DocumentPatch): DocumentPatch {
  const out: DocumentPatch = { ...patch }
  if (patch.title !== undefined) out.title = squish(patch.title ?? '') || null
  if (patch.bodyText !== undefined) out.bodyText = normalizeText(patch.bodyText ?? '') || null
  if (patch.kind !== undefined) out.kind = trimToNull(patch.kind)
  if (patch.summary !== undefined) out.summary = trimToNull(patch.summary)
  if (patch.originalUrl !== undefined) out.originalUrl = trimToNull(patch.originalUrl)
  return out
}
