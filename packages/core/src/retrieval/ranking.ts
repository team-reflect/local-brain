/**
 * Pure ranking math for retrieval. Kept free of I/O so it can be unit-tested in
 * isolation. The retrieval query does the heavy lexical work in SQLite (bm25);
 * these helpers combine that lexical signal with recency and explicit-link
 * boosts into one comparable score.
 */

/** Half-life (days) for the recency decay. ~A quarter feels "current". */
export const RECENCY_HALF_LIFE_DAYS = 90

/**
 * SQLite's `bm25()` returns a value where *more negative is more relevant*. Map
 * it to a positive, bounded [0, 1] lexical score so it composes with the other
 * factors. A perfect-ish match (bm25 ≈ -10) approaches 1; a weak match (≈ 0)
 * approaches 0.
 */
export function lexicalScore(bm25: number): number {
  const magnitude = Math.max(0, -bm25)
  return magnitude / (magnitude + 4)
}

/**
 * Exponential recency decay in [0, 1]. `1` for something from today, halving
 * every {@link RECENCY_HALF_LIFE_DAYS}. A missing/invalid date is treated as
 * neutral-old (0.25) rather than zero so undated records still surface.
 */
export function recencyScore(recordDate: string | null, now: Date = new Date()): number {
  if (!recordDate) return 0.25
  const then = Date.parse(recordDate)
  if (Number.isNaN(then)) return 0.25
  const ageDays = Math.max(0, (now.getTime() - then) / 86_400_000)
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS)
}

export interface RankInputs {
  /** Positive lexical relevance in [0, 1] (see {@link lexicalScore}). */
  lexical: number
  /** Recency in [0, 1] (see {@link recencyScore}). */
  recency: number
  /** `true` when the hit links to an actively-boosted record (project/person/view). */
  linked?: boolean
}

/**
 * Combine the signals into one score. Lexical relevance dominates (a query is
 * first and foremost a text match); recency and an explicit link to the user's
 * current context nudge ties. The link boost is multiplicative so it only ever
 * helps an already-relevant hit, never resurrects an irrelevant one.
 */
export function combineScore({ lexical, recency, linked }: RankInputs): number {
  const base = lexical * 0.7 + recency * 0.3
  return linked ? base * 1.25 : base
}
