/**
 * Field normalization shared by the write boundary (domain validators), the
 * deterministic extraction matcher, and the `brain` CLI's Rust twin
 * (`apps/cli/src/normalize.rs`). Keep the two in sync — both feed the same
 * duplicate-detection keys, so they must agree.
 *
 * Two flavours live here:
 *   - *Match* normalizers (`normalizeName`/`normalizeEmail`/`normalizeDomain`)
 *     fold case and punctuation so two spellings of the same thing collide.
 *     They are for comparison keys, not for display.
 *   - *Storage* normalizers (`squish`/`trimToNull`) clean a value for durable
 *     storage while preserving its human-facing form (case, internal spacing
 *     down to single spaces).
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

/** Normalize an email for comparison and storage (trim + lowercase). */
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

/**
 * Collapse internal runs of whitespace to single spaces and trim the ends, while
 * preserving case. The storage form for display names and short labels: `"  Ada
 *  Lovelace \n"` becomes `"Ada Lovelace"`.
 */
export function squish(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** Trim a value; collapse empty/whitespace-only (or nullish) input to `null`. */
export function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
