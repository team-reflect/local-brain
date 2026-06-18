import { db } from '../../db/client'
import { nowIso } from '../../db/time'
import { daysBetween } from './strength'

/**
 * Read side of relationship intelligence (Plan 05 step 9): the reconnect
 * suggestions that feed Today and a person's detail page. These read the derived
 * `next_reconnect_at` column that {@link recomputeRelationshipIntelligence}
 * keeps fresh — so suggestions are just a fast, indexed projection, no scoring at
 * read time.
 */

export interface ReconnectSuggestion {
  id: string
  fullName: string
  relationshipStrength: number | null
  lastInteractionAt: string | null
  nextReconnectAt: string
  /** Whole days overdue (≥ 0) as of the query time. */
  overdueDays: number
}

export interface ReconnectOptions {
  /** "Now" used to decide what is overdue; defaults to {@link nowIso}. */
  asOf?: string
  limit?: number
}

/**
 * People who are due (or overdue) for a reconnect — those with a derived
 * next-reconnect date at or before `asOf` — most overdue first. Self and
 * archived people are excluded.
 */
export async function listReconnectSuggestions(
  options: ReconnectOptions = {},
): Promise<ReconnectSuggestion[]> {
  const asOf = options.asOf ?? nowIso()
  let query = db
    .selectFrom('people')
    .where('isSelf', '=', 0)
    .where('archivedAt', 'is', null)
    .where('nextReconnectAt', 'is not', null)
    .where('nextReconnectAt', '<=', asOf)
    .orderBy('nextReconnectAt', 'asc')
    .select(['id', 'fullName', 'relationshipStrength', 'lastInteractionAt', 'nextReconnectAt'])
  if (options.limit !== undefined) {
    query = query.limit(options.limit)
  }
  const rows = await query.execute()
  return rows.map((row) => ({
    id: row.id,
    fullName: row.fullName,
    relationshipStrength: row.relationshipStrength,
    lastInteractionAt: row.lastInteractionAt,
    // The `is not null` filter guarantees a value; assert it for the type.
    nextReconnectAt: row.nextReconnectAt as string,
    overdueDays: daysBetween(row.nextReconnectAt as string, asOf),
  }))
}
