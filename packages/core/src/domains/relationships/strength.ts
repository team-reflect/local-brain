/**
 * Pure, deterministic relationship-intelligence math (Plan 05 step 9). No
 * database, no model — just the date helpers and the strength formula, kept
 * separate so they can be unit-tested in isolation and reasoned about. The
 * recompute pass in `recompute.ts` reads signals from interactions/tasks and
 * feeds them here.
 */

/** Window (days) over which interaction frequency counts toward strength. */
export const STRENGTH_WINDOW_DAYS = 365

const MS_PER_DAY = 86_400_000

/** Whole days from `fromIso` to `toIso` (negative if `toIso` is earlier). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / MS_PER_DAY)
}

/** `iso` shifted by `days`, as an ISO-8601 UTC timestamp. */
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * MS_PER_DAY).toISOString()
}

export interface RelationshipSignals {
  /** Non-archived interactions with this person within the strength window. */
  recentInteractions: number
  /** Whole days since the most recent interaction, or null if there are none. */
  daysSinceLast: number | null
  /** Open (not done, not archived) tasks the person is linked to. */
  openTasks: number
}

/**
 * A 1–5 relationship strength derived purely from how often and how recently the
 * user interacts with a person plus how many open tasks they share. Transparent
 * and explainable, not learned:
 *
 * - frequency: +1 per recent interaction, capped at 5
 * - recency: +3 (≤30d) / +2 (≤90d) / +1 (≤180d) since the last interaction
 * - collaboration: +1 per shared open task, capped at 2
 *
 * The total buckets into 1–5. Returns `null` when there is no signal at all (no
 * interactions and no open tasks) so the read-only projection does not invent a
 * strength for a person we simply have no data about yet.
 */
export function relationshipStrength(signals: RelationshipSignals): number | null {
  const { recentInteractions, daysSinceLast, openTasks } = signals
  if (recentInteractions === 0 && openTasks === 0) return null

  let score = Math.min(recentInteractions, 5)
  if (daysSinceLast !== null) {
    if (daysSinceLast <= 30) score += 3
    else if (daysSinceLast <= 90) score += 2
    else if (daysSinceLast <= 180) score += 1
  }
  score += Math.min(openTasks, 2)

  if (score >= 8) return 5
  if (score >= 6) return 4
  if (score >= 4) return 3
  if (score >= 2) return 2
  return 1
}
