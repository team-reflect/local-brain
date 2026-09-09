import { normalizeText } from '../../ingest/chunk'
import { squish, trimToNull } from '../../text/normalize'
import { ValidationError } from '../../validation'
import type { NewInteraction, InteractionPatch } from './setters'

/**
 * Normalize and validate an interaction write. Like documents, both `title` and
 * `body_text` are nullable in SQLite, so this rejects an interaction with
 * neither. `kind` is left untouched: it is `NOT NULL DEFAULT 'note'`, a
 * controlled value its callers own.
 */
export function validateNewInteraction(input: NewInteraction): NewInteraction {
  const { kind: _kind, ...fields } = input
  const clean = validateInteractionPatch(fields)
  const title = clean.title ?? null
  const bodyText = clean.bodyText ?? null
  if (!title && !bodyText) {
    throw new ValidationError('an interaction needs a title or body text')
  }
  return { ...input, ...clean, title, bodyText }
}

export function validateInteractionPatch(patch: InteractionPatch): InteractionPatch {
  const out: InteractionPatch = { ...patch }
  if (patch.title !== undefined) out.title = squish(patch.title ?? '') || null
  if (patch.bodyText !== undefined) out.bodyText = normalizeText(patch.bodyText ?? '') || null
  if (patch.summary !== undefined) out.summary = trimToNull(patch.summary)
  if (patch.location !== undefined) out.location = trimToNull(patch.location)
  if (patch.externalId !== undefined) out.externalId = trimToNull(patch.externalId)
  if (patch.originalUrl !== undefined) out.originalUrl = trimToNull(patch.originalUrl)
  return out
}
