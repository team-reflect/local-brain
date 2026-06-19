import { normalizeText } from '../../ingest/chunk'
import { squish, trimToNull } from '../../text/normalize'
import { ValidationError } from '../../validation'
import type { NewInteraction, InteractionPatch } from './setters'

function labelOrNull(value: string | null | undefined): string | null {
  if (value == null) return null
  return squish(value) || null
}

function bodyOrNull(value: string | null | undefined): string | null {
  if (value == null) return null
  return normalizeText(value) || null
}

/**
 * Normalize and validate an interaction write. Like documents, both `title` and
 * `body_text` are nullable in SQLite, so this rejects an interaction with
 * neither. `kind` is left untouched: it is `NOT NULL DEFAULT 'note'`, a
 * controlled value its callers own.
 */
export function validateNewInteraction(input: NewInteraction): NewInteraction {
  const out: NewInteraction = { ...input }
  const title = labelOrNull(input.title)
  const body = bodyOrNull(input.bodyText)
  if (!title && !body) {
    throw new ValidationError('an interaction needs a title or body text')
  }
  out.title = title
  out.bodyText = body
  if (input.summary !== undefined) out.summary = trimToNull(input.summary)
  if (input.location !== undefined) out.location = trimToNull(input.location)
  if (input.externalId !== undefined) out.externalId = trimToNull(input.externalId)
  if (input.originalUrl !== undefined) out.originalUrl = trimToNull(input.originalUrl)
  return out
}

export function validateInteractionPatch(patch: InteractionPatch): InteractionPatch {
  const out: InteractionPatch = { ...patch }
  if (patch.title !== undefined) out.title = labelOrNull(patch.title)
  if (patch.bodyText !== undefined) out.bodyText = bodyOrNull(patch.bodyText)
  if (patch.summary !== undefined) out.summary = trimToNull(patch.summary)
  if (patch.location !== undefined) out.location = trimToNull(patch.location)
  if (patch.externalId !== undefined) out.externalId = trimToNull(patch.externalId)
  if (patch.originalUrl !== undefined) out.originalUrl = trimToNull(patch.originalUrl)
  return out
}
