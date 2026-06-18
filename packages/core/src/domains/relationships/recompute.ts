import { db } from '../../db/client'
import { execute } from '../../db/commands'
import { nowIso } from '../../db/time'
import type { PersonPatch } from '../people/setters'
import {
  addDays,
  daysBetween,
  nextReconnectAt,
  relationshipStrength,
  STRENGTH_WINDOW_DAYS,
} from './strength'

/**
 * Relationship-intelligence recompute (Plan 05 step 9). Derives a person's
 * follow-up hints — last-interaction date, next-reconnect date, and a 1–5
 * relationship strength — purely from their interactions and shared tasks, then
 * writes them onto the `people` row. This is deterministic projection, not AI: it
 * only summarizes data the user already has.
 *
 * Fields it owns:
 * - `last_interaction_at`: the most recent dated interaction (null if none).
 * - `next_reconnect_at`: last interaction + the person's reconnect cadence.
 * - `relationship_strength`: the {@link relationshipStrength} score — written
 *   only when there is a signal, so a manual value survives for people we have no
 *   data on.
 *
 * It never touches `reconnect_interval_days` (a user-set cadence input) or
 * `important_dates_json` (no field in the current schema supplies birthdays /
 * anniversaries to derive — see the build notes).
 */

export interface RecomputeOptions {
  /** "Now" for recency math; defaults to {@link nowIso}. Injected for tests. */
  asOf?: string
}

/** Recompute and persist one person's relationship hints. No-op for unknown/self rows. */
export async function recomputeRelationshipIntelligence(
  personId: string,
  options: RecomputeOptions = {},
): Promise<void> {
  const asOf = options.asOf ?? nowIso()
  const windowStart = addDays(asOf, -STRENGTH_WINDOW_DAYS)

  const person = await db
    .selectFrom('people')
    .select(['id', 'reconnectIntervalDays'])
    .where('id', '=', personId)
    .where('isSelf', '=', 0)
    .executeTakeFirst()
  if (!person) return

  const [lastRow, recentRow, openRow] = await Promise.all([
    db
      .selectFrom('interactions')
      .innerJoin('interactionParticipants', 'interactionParticipants.interactionId', 'interactions.id')
      .where('interactionParticipants.personId', '=', personId)
      .where('interactions.archivedAt', 'is', null)
      .where('interactions.occurredAt', 'is not', null)
      .select((eb) => eb.fn.max('interactions.occurredAt').as('lastAt'))
      .executeTakeFirst(),
    db
      .selectFrom('interactions')
      .innerJoin('interactionParticipants', 'interactionParticipants.interactionId', 'interactions.id')
      .where('interactionParticipants.personId', '=', personId)
      .where('interactions.archivedAt', 'is', null)
      .where('interactions.occurredAt', '>=', windowStart)
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirst(),
    db
      .selectFrom('tasks')
      .innerJoin('taskPeople', 'taskPeople.taskId', 'tasks.id')
      .where('taskPeople.personId', '=', personId)
      .where('tasks.archivedAt', 'is', null)
      .where('tasks.status', '!=', 'done')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirst(),
  ])

  const lastInteractionAt = lastRow?.lastAt ?? null
  const recentInteractions = Number(recentRow?.n ?? 0)
  const openTasks = Number(openRow?.n ?? 0)
  const daysSinceLast = lastInteractionAt ? daysBetween(lastInteractionAt, asOf) : null

  const strength = relationshipStrength({ recentInteractions, daysSinceLast, openTasks })

  const patch: PersonPatch = {
    lastInteractionAt,
    nextReconnectAt: nextReconnectAt(lastInteractionAt, person.reconnectIntervalDays),
    updatedAt: asOf,
  }
  if (strength !== null) patch.relationshipStrength = strength

  await execute(db.updateTable('people').set(patch).where('id', '=', personId))
}

/**
 * Recompute every non-archived, non-self person. Returns the number recomputed.
 * Useful on first-run seeding and as a manual refresh; routine updates happen
 * incrementally when an interaction is created (see interactions/ingest).
 */
export async function recomputeAllRelationships(options: RecomputeOptions = {}): Promise<number> {
  const people = await db
    .selectFrom('people')
    .select('id')
    .where('isSelf', '=', 0)
    .where('archivedAt', 'is', null)
    .execute()
  for (const person of people) {
    await recomputeRelationshipIntelligence(person.id, options)
  }
  return people.length
}
