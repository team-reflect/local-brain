import { normalizeText } from '../../ingest/chunk'
import { squish, trimToNull } from '../../text/normalize'
import { ValidationError } from '../../validation'
import type { NewDocument, DocumentPatch } from './setters'

/** Squish a label to its storage form, collapsing blank to `null`. */
function labelOrNull(value: string | null | undefined): string | null {
  if (value == null) return null
  return squish(value) || null
}

/** Canonicalize body text (newlines, trailing space), collapsing blank to `null`. */
function bodyOrNull(value: string | null | undefined): string | null {
  if (value == null) return null
  return normalizeText(value) || null
}

/**
 * Normalize and validate a document write. The SQLite schema makes both `title`
 * and `body_text` nullable, so a totally empty document would pass — this rejects
 * one with neither a title nor body, since it would be unreadable and
 * unsearchable.
 */
export function validateNewDocument(input: NewDocument): NewDocument {
  const out: NewDocument = { ...input }
  const title = labelOrNull(input.title)
  const body = bodyOrNull(input.bodyText)
  if (!title && !body) {
    throw new ValidationError('a document needs a title or body text')
  }
  out.title = title
  out.bodyText = body
  if (input.kind !== undefined) out.kind = trimToNull(input.kind)
  if (input.summary !== undefined) out.summary = trimToNull(input.summary)
  if (input.originalUrl !== undefined) out.originalUrl = trimToNull(input.originalUrl)
  return out
}

export function validateDocumentPatch(patch: DocumentPatch): DocumentPatch {
  const out: DocumentPatch = { ...patch }
  if (patch.title !== undefined) out.title = labelOrNull(patch.title)
  if (patch.bodyText !== undefined) out.bodyText = bodyOrNull(patch.bodyText)
  if (patch.kind !== undefined) out.kind = trimToNull(patch.kind)
  if (patch.summary !== undefined) out.summary = trimToNull(patch.summary)
  if (patch.originalUrl !== undefined) out.originalUrl = trimToNull(patch.originalUrl)
  return out
}
