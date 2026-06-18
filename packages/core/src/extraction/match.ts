import { db } from '../db/client'
import type { ExtractedOrganization, ExtractedPerson, ExtractedProject } from './contracts'

/**
 * Deterministic merge/upsert matching (Plan 05 step 4).
 *
 * Extraction proposes people, organizations, and projects that may already
 * exist. These pure matchers decide whether a proposed entity should reuse an
 * existing row (so a meeting transcript updates the same person instead of
 * spawning a duplicate) or create a new one. No model is involved — matching is
 * exact-key first, then normalized-name, which is conservative on purpose:
 * fuzzy/embedding matching is a deliberate follow-up.
 */

/** Lowercase, collapse internal whitespace, drop surrounding punctuation. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // strip combining diacritics
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Normalize an email for comparison (trim + lowercase). */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const trimmed = email.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

/** Normalize a domain (strip scheme, leading `www.`, trailing slash, lowercase). */
export function normalizeDomain(domain: string | null | undefined): string | null {
  if (!domain) return null
  const trimmed = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
  return trimmed.length > 0 ? trimmed : null
}

export interface PersonCandidate {
  id: string
  fullName: string
  primaryEmail: string | null
}

export interface OrganizationCandidate {
  id: string
  name: string
  domain: string | null
}

export interface ProjectCandidate {
  id: string
  name: string
}

/**
 * Match a proposed person against existing rows: exact email first (the strong
 * signal), then normalized full name. Returns the matched id or null.
 */
export function matchPerson(
  proposed: Pick<ExtractedPerson, 'fullName' | 'primaryEmail'>,
  candidates: readonly PersonCandidate[],
): string | null {
  const email = normalizeEmail(proposed.primaryEmail)
  if (email) {
    const byEmail = candidates.find((c) => normalizeEmail(c.primaryEmail) === email)
    if (byEmail) return byEmail.id
  }
  const name = normalizeName(proposed.fullName)
  if (!name) return null
  const byName = candidates.find((c) => normalizeName(c.fullName) === name)
  return byName?.id ?? null
}

/** Match a proposed organization: domain first, then normalized name. */
export function matchOrganization(
  proposed: Pick<ExtractedOrganization, 'name' | 'domain'>,
  candidates: readonly OrganizationCandidate[],
): string | null {
  const domain = normalizeDomain(proposed.domain)
  if (domain) {
    const byDomain = candidates.find((c) => normalizeDomain(c.domain) === domain)
    if (byDomain) return byDomain.id
  }
  const name = normalizeName(proposed.name)
  if (!name) return null
  const byName = candidates.find((c) => normalizeName(c.name) === name)
  return byName?.id ?? null
}

/** Match a proposed project by normalized name. */
export function matchProject(
  proposed: Pick<ExtractedProject, 'name'>,
  candidates: readonly ProjectCandidate[],
): string | null {
  const name = normalizeName(proposed.name)
  if (!name) return null
  return candidates.find((c) => normalizeName(c.name) === name)?.id ?? null
}

/** Load existing, non-archived people as match candidates. */
export function loadPersonCandidates(): Promise<PersonCandidate[]> {
  return db
    .selectFrom('people')
    .where('archivedAt', 'is', null)
    .select(['id', 'fullName', 'primaryEmail'])
    .execute()
}

/** Load existing, non-archived organizations as match candidates. */
export function loadOrganizationCandidates(): Promise<OrganizationCandidate[]> {
  return db
    .selectFrom('organizations')
    .where('archivedAt', 'is', null)
    .select(['id', 'name', 'domain'])
    .execute()
}

/** Load existing, non-archived projects as match candidates. */
export function loadProjectCandidates(): Promise<ProjectCandidate[]> {
  return db
    .selectFrom('projects')
    .where('archivedAt', 'is', null)
    .select(['id', 'name'])
    .execute()
}
