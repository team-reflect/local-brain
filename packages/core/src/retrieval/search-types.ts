import type { RecordKind } from '../domains/relations/types'

export interface SearchHit {
  kind: RecordKind
  id: string
  title: string
  subtitle: string | null
  /** A short matched excerpt for FTS hits; null for name hits. */
  snippet: string | null
  score: number
}

export interface SearchOptions {
  /** Max hits per kind before the final merge. */
  perKind?: number
  /** Final result cap. */
  limit?: number
  /** Restrict to a subset of record kinds. */
  kinds?: readonly RecordKind[]
  now?: Date
}
