import { db } from '../../db/client'
import { execute } from '../../db/commands'
import { nowIso } from '../../db/time'
import type { PersonPatch } from '../people/setters'
import { nextReconnectAt } from './strength'

/**
 * Relationship-intelligence recompute (Plan 05 step 9). Derives a person's
 * follow-up hints — last-interaction date and next-reconnect date — purely from
 * their interactions and reconnect cadence, then writes them onto the `people`
 * row. This is deterministic projection, not AI: it only summarizes data the
 * user already has.
 *
 * Fields it owns:
 * - `last_interaction_at`: the most recent dated interaction (null if none).
 * - `next_reconnect_at`: last interaction + the person's reconnect cadence.
 *
 * It never touches `reconnect_interval_days` (a user-set cadence input) or
 * `important_dates_json` (no field in the current schema supplies birthdays /
 * anniversaries to derive — see the build notes). Relationship strength is a
 * SELECT-only SQL view (`relationship_strengths`), so no agent can persist an
 * arbitrary value onto a person row.
 */

export interface RecomputeOptions {
  /** Timestamp used for updated_at; defaults to {@link nowIso}. Injected for tests. */
  asOf?: string
}

/** Recompute and persist one person's relationship hints. No-op for unknown/self rows. */
export async function recomputeRelationshipIntelligence(
  personId: string,
  options: RecomputeOptions = {},
): Promise<void> {
  const asOf = options.asOf ?? nowIso()

  const person = await db
    .selectFrom('people')
    .select(['id', 'reconnectIntervalDays'])
    .where('id', '=', personId)
    .where('isSelf', '=', 0)
    .executeTakeFirst()
  if (!person) return

  const lastRow = await db
    .selectFrom('interactions')
    .innerJoin('interactionParticipants', 'interactionParticipants.interactionId', 'interactions.id')
    .where('interactionParticipants.personId', '=', personId)
    .where('interactions.archivedAt', 'is', null)
    .where('interactions.occurredAt', 'is not', null)
    .select((eb) => eb.fn.max('interactions.occurredAt').as('lastAt'))
    .executeTakeFirst()

  const lastInteractionAt = lastRow?.lastAt ?? null

  const patch: PersonPatch = {
    lastInteractionAt,
    nextReconnectAt: nextReconnectAt(lastInteractionAt, person.reconnectIntervalDays),
    updatedAt: asOf,
  }

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
