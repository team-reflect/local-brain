import type { RelatedRecordRef } from './related-records'
import type {
  NavigableRecordType,
  RetrievalMode,
  SortMode,
  SourceRecordType,
} from './retrieve'
export type { NavigableRecordType } from './retrieve'

/** A compact, inspectable chunk pointer carried by a record candidate. */
export interface RecordCandidateEvidence {
  chunkId: string
  chunkIndex: number
  snippet: string
}

/** One unique record discovered from direct fields and/or chunk retrieval. */
export interface RecordCandidate {
  recordType: SourceRecordType
  recordId: string
  recordRef: string
  title: string | null
  date: string | null
  /** Existing detail record that should open for this source, when one exists. */
  navigationRecordType: NavigableRecordType | null
  navigationRecordId: string | null
  /** At most the two best matching chunks for follow-up inspection. */
  evidence: RecordCandidateEvidence[]
  matchReasons: string[]
}

/** Query legs, structural filters, ordering, and result cap for record discovery. */
export interface RecordCandidateSearchOptions {
  /** Retrieval legs to use; hybrid falls back to lexical when semantic is unavailable. */
  mode?: RetrievalMode
  /** Maximum unique records returned. */
  limit?: number
  /** Convenience filter for one source type. */
  recordType?: SourceRecordType
  /** Source types eligible for retrieval. */
  recordTypes?: readonly SourceRecordType[]
  /** Interaction kinds eligible for retrieval, including transcript parents. */
  kinds?: readonly string[]
  /** Inclusive lower bound on the record's canonical ISO 8601 date. */
  after?: string
  /** Inclusive upper bound on the record's canonical ISO 8601 date. */
  before?: string
  /** Relevance by default, or explicit chronological ordering. */
  sort?: SortMode
  /** Every typed ref must be related to a candidate (AND semantics). */
  relatedTo?: readonly RelatedRecordRef[]
}

/** Ranked record-level discovery result with semantic-leg availability metadata. */
export interface RecordCandidateSearchResult {
  /** The original unmodified query supplied by the caller. */
  query: string
  /** Effective retrieval mode after applying defaults. */
  mode: RetrievalMode
  /** Whether the semantic leg returned eligible hits for record-level fusion. */
  semanticAvailable: boolean
  /** Ranked unique records, already capped by the requested limit. */
  candidates: RecordCandidate[]
}

export interface InternalCandidate extends RecordCandidate {
  exactTitle: boolean
  quality: number
  termMatches: number
}

export function candidateKey(
  candidate: Pick<RecordCandidate, 'recordType' | 'recordId'>,
): string {
  return `${candidate.recordType}:${candidate.recordId}`
}

export function candidateRecordTime(date: string | null): number {
  if (!date) return Number.NEGATIVE_INFINITY
  const parsed = Date.parse(date)
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

export function newInternalCandidate(
  recordType: SourceRecordType,
  recordId: string,
  title: string | null,
  date: string | null,
  reasons: readonly string[],
  navigation?: { recordType: NavigableRecordType; recordId: string } | null,
): InternalCandidate {
  const directNavigation = navigableRecordType(recordType)
  return {
    recordType,
    recordId,
    recordRef: `${recordType}:${recordId}`,
    title,
    date,
    navigationRecordType: navigation?.recordType ?? directNavigation,
    navigationRecordId: navigation?.recordId ?? (directNavigation ? recordId : null),
    evidence: [],
    matchReasons: [...reasons],
    exactTitle: false,
    quality: 4,
    termMatches: 0,
  }
}

function navigableRecordType(recordType: SourceRecordType): NavigableRecordType | null {
  switch (recordType) {
    case 'person':
    case 'organization':
    case 'project':
    case 'task':
    case 'document':
    case 'interaction':
    case 'asset':
      return recordType
    default:
      return null
  }
}
