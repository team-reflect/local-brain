import { normalizeEmail, squish, trimToNull } from '../../text/normalize'
import { requireText } from '../../validation'
import type { NewPerson, PersonPatch } from './setters'

/**
 * Normalize and validate a person write. `fullName` is `NOT NULL` in SQLite but
 * the schema still accepts `""`; this rejects that and folds emails to a single
 * comparison form so duplicate detection (`extraction/match.ts`) and storage
 * agree. Returns a cleaned copy — pure, so it is unit-tested directly.
 */
export function validateNewPerson(input: NewPerson): NewPerson {
  const out: NewPerson = { ...input }
  out.fullName = squish(requireText('full name', input.fullName))
  if (input.preferredName !== undefined) out.preferredName = trimToNull(input.preferredName)
  if (input.headline !== undefined) out.headline = trimToNull(input.headline)
  if (input.primaryEmail !== undefined) out.primaryEmail = normalizeEmail(input.primaryEmail)
  if (input.primaryPhone !== undefined) out.primaryPhone = trimToNull(input.primaryPhone)
  if (input.location !== undefined) out.location = trimToNull(input.location)
  if (input.summary !== undefined) out.summary = trimToNull(input.summary)
  if (input.notes !== undefined) out.notes = trimToNull(input.notes)
  return out
}

export function validatePersonPatch(patch: PersonPatch): PersonPatch {
  const out: PersonPatch = { ...patch }
  if (patch.fullName !== undefined) out.fullName = squish(requireText('full name', patch.fullName))
  if (patch.preferredName !== undefined) out.preferredName = trimToNull(patch.preferredName)
  if (patch.headline !== undefined) out.headline = trimToNull(patch.headline)
  if (patch.primaryEmail !== undefined) out.primaryEmail = normalizeEmail(patch.primaryEmail)
  if (patch.primaryPhone !== undefined) out.primaryPhone = trimToNull(patch.primaryPhone)
  if (patch.location !== undefined) out.location = trimToNull(patch.location)
  if (patch.summary !== undefined) out.summary = trimToNull(patch.summary)
  if (patch.notes !== undefined) out.notes = trimToNull(patch.notes)
  return out
}
