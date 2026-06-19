import { db } from '../db/client'
import {
  loadOrganizationCandidates,
  loadPersonCandidates,
  type OrganizationCandidate,
  type PersonCandidate,
} from './match'

/**
 * Deterministic pre-processing (Plan 05 step 2).
 *
 * Before any model runs, we assemble a typed {@link ExtractionContext} for a
 * source record: its chunks, hint signals pulled out with plain rules (dates,
 * email addresses, known participants), and the existing people/organizations a
 * model should try to merge against rather than duplicate. This is pure-ish data
 * assembly — no model, no writes — so it is cheap, testable, and identical
 * whether extraction ultimately runs locally or via a BYOK adapter.
 */

export type SourceRecordType = 'document' | 'interaction'

export interface ContextChunk {
  index: number
  text: string
}

export interface DateHint {
  /** The matched substring, e.g. `2026-06-17`. */
  value: string
  /** Character offset of the match within the scanned text. */
  index: number
}

export interface ExtractionContext {
  source: {
    recordType: SourceRecordType
    recordId: string
    title: string | null
    bodyText: string | null
  }
  chunks: ContextChunk[]
  /** Distinct dates found in the body, in order of appearance. */
  dates: DateHint[]
  /** Distinct email addresses found in the body, lowercased. */
  emails: string[]
  /** People already linked to the record (e.g. interaction participants). */
  knownPersonIds: string[]
  /** Existing rows a model should merge against instead of duplicating. */
  duplicateCandidates: {
    people: PersonCandidate[]
    organizations: OrganizationCandidate[]
  }
}

// ISO `YYYY-MM-DD` and common `Month D, YYYY` forms. Deliberately small and
// unambiguous — richer date parsing is a follow-up, not a guess engine.
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g
const MONTH_NAMES =
  'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec'
const LONG_DATE = new RegExp(`\\b(?:${MONTH_NAMES})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, 'gi')
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g

/** Find candidate dates in text, in order of appearance, de-duplicated by value. */
export function findDates(text: string): DateHint[] {
  const hits: DateHint[] = []
  const seen = new Set<string>()
  for (const re of [ISO_DATE, LONG_DATE]) {
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      const value = match[0]
      const key = `${value}@${match.index}`
      if (seen.has(key)) continue
      seen.add(key)
      hits.push({ value, index: match.index })
    }
  }
  return hits.sort((a, b) => a.index - b.index)
}

/** Find distinct email addresses in text (lowercased, first-seen order). */
export function findEmails(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  EMAIL.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = EMAIL.exec(text)) !== null) {
    const email = match[0].toLowerCase()
    if (seen.has(email)) continue
    seen.add(email)
    out.push(email)
  }
  return out
}

export interface SelectChunksOptions {
  /** Maximum chunks to hand to the model (default: all). */
  limit?: number
}

/**
 * Choose which chunks to send to the model. First-wave policy is "all chunks in
 * order", optionally capped — keeping the index stable so evidence refs line up
 * with `content_chunks.chunk_index`.
 */
export function selectChunks(
  chunks: readonly ContextChunk[],
  options: SelectChunksOptions = {},
): ContextChunk[] {
  const ordered = [...chunks].sort((a, b) => a.index - b.index)
  return options.limit === undefined ? ordered : ordered.slice(0, options.limit)
}

/** Load a source record (document or interaction) plus its chunks and hints. */
export async function buildExtractionContext(
  recordType: SourceRecordType,
  recordId: string,
  options: SelectChunksOptions = {},
): Promise<ExtractionContext> {
  const record =
    recordType === 'document'
      ? await db
          .selectFrom('documents')
          .select(['id', 'title', 'bodyText'])
          .where('id', '=', recordId)
          .executeTakeFirst()
      : await db
          .selectFrom('interactions')
          .select(['id', 'title', 'bodyText'])
          .where('id', '=', recordId)
          .executeTakeFirst()

  if (!record) {
    throw new Error(`cannot build extraction context: ${recordType} ${recordId} not found`)
  }

  const chunkRows = await db
    .selectFrom('contentChunks')
    .select(['chunkIndex', 'text'])
    .where('recordType', '=', recordType)
    .where('recordId', '=', recordId)
    .orderBy('chunkIndex', 'asc')
    .execute()

  const chunks = selectChunks(
    chunkRows.map((row) => ({ index: row.chunkIndex, text: row.text })),
    options,
  )

  const knownPersonIds =
    recordType === 'interaction'
      ? (
          await db
            .selectFrom('interactionParticipants')
            .select('personId')
            .where('interactionId', '=', recordId)
            .execute()
        )
          .map((row) => row.personId)
          .filter((personId): personId is string => personId !== null)
      : (
          await db
            .selectFrom('documentPeople')
            .select('personId')
            .where('documentId', '=', recordId)
            .execute()
        ).map((row) => row.personId)

  const body = record.bodyText ?? ''
  const [people, organizations] = await Promise.all([
    loadPersonCandidates(),
    loadOrganizationCandidates(),
  ])

  return {
    source: { recordType, recordId, title: record.title, bodyText: record.bodyText },
    chunks,
    dates: findDates(body),
    emails: findEmails(body),
    knownPersonIds,
    duplicateCandidates: { people, organizations },
  }
}
