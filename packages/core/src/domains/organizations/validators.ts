import { normalizeDomain, squish, trimToNull } from '../../text/normalize'
import { requireText } from '../../validation'
import type { NewOrganization, OrganizationPatch } from './setters'

/**
 * Normalize and validate an organization write. `name` is required (non-blank)
 * and `domain` is folded to the same comparison form the matcher uses, so an
 * org typed as `https://www.Acme.com/` and one typed as `acme.com` dedupe.
 */
export function validateNewOrganization(input: NewOrganization): NewOrganization {
  const clean = validateOrganizationPatch(input)
  return { ...clean, name: requireText('name', clean.name) }
}

export function validateOrganizationPatch(patch: OrganizationPatch): OrganizationPatch {
  const out: OrganizationPatch = { ...patch }
  if (patch.name !== undefined) out.name = squish(requireText('name', patch.name))
  if (patch.kind !== undefined) out.kind = trimToNull(patch.kind)
  if (patch.domain !== undefined) out.domain = normalizeDomain(patch.domain)
  if (patch.location !== undefined) out.location = trimToNull(patch.location)
  if (patch.summary !== undefined) out.summary = trimToNull(patch.summary)
  if (patch.notes !== undefined) out.notes = trimToNull(patch.notes)
  return out
}
