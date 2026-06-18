import { db } from '../../db/client'
import { nowIso } from '../../db/time'
import {
  addDays,
  daysBetween,
  relationshipStrength,
  STRENGTH_WINDOW_DAYS,
} from './strength'

/**
 * Read side of relationship intelligence (Plan 05 step 9): the reconnect
 * suggestions that feed Today and a person's detail page. These read the derived
 * `next_reconnect_at` column that {@link recomputeRelationshipIntelligence}
 * keeps fresh and calculate network strength from read-only signals using the
 * same `asOf` timestamp as the due-date filter.
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
  const windowStart = addDays(asOf, -STRENGTH_WINDOW_DAYS)
  let query = db
    .selectFrom('people')
    .where('people.isSelf', '=', 0)
    .where('people.archivedAt', 'is', null)
    .where('people.nextReconnectAt', 'is not', null)
    .where('people.nextReconnectAt', '<=', asOf)
    .orderBy('people.nextReconnectAt', 'asc')
    .select([
      'people.id',
      'people.fullName',
      'people.lastInteractionAt',
      'people.nextReconnectAt',
    ])
  if (options.limit !== undefined) {
    query = query.limit(options.limit)
  }
  const rows = await query.execute()
  return Promise.all(
    rows.map(async (row) => {
      const [lastRow, recentRow, openRow] = await Promise.all([
        db
          .selectFrom('interactions')
          .innerJoin('interactionParticipants', 'interactionParticipants.interactionId', 'interactions.id')
          .where('interactionParticipants.personId', '=', row.id)
          .where('interactions.archivedAt', 'is', null)
          .where('interactions.occurredAt', 'is not', null)
          .where('interactions.occurredAt', '<=', asOf)
          .select((eb) => eb.fn.max('interactions.occurredAt').as('lastAt'))
          .executeTakeFirst(),
        db
          .selectFrom('interactions')
          .innerJoin('interactionParticipants', 'interactionParticipants.interactionId', 'interactions.id')
          .where('interactionParticipants.personId', '=', row.id)
          .where('interactions.archivedAt', 'is', null)
          .where('interactions.occurredAt', '>=', windowStart)
          .where('interactions.occurredAt', '<=', asOf)
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .executeTakeFirst(),
        db
          .selectFrom('tasks')
          .innerJoin('taskPeople', 'taskPeople.taskId', 'tasks.id')
          .where('taskPeople.personId', '=', row.id)
          .where('tasks.archivedAt', 'is', null)
          .where('tasks.status', '!=', 'done')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .executeTakeFirst(),
      ])
      const lastInteractionAt = lastRow?.lastAt ?? null
      const recentInteractions = Number(recentRow?.n ?? 0)
      const openTasks = Number(openRow?.n ?? 0)
      const daysSinceLast = lastInteractionAt ? daysBetween(lastInteractionAt, asOf) : null

      return {
        id: row.id,
        fullName: row.fullName,
        relationshipStrength: relationshipStrength({ recentInteractions, daysSinceLast, openTasks }),
        lastInteractionAt,
        // The `is not null` filter guarantees a value; assert it for the type.
        nextReconnectAt: row.nextReconnectAt as string,
        overdueDays: daysBetween(row.nextReconnectAt as string, asOf),
      }
    }),
  )
}
