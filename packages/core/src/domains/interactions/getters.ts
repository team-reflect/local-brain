import type { Selectable } from 'kysely'
import type { Interactions, People } from '@local-brain/db'
import { db } from '../../db/client'

export type Interaction = Selectable<Interactions>
export type InteractionParticipant = Selectable<People>

export interface ListInteractionsOptions {
  includeArchived?: boolean
  limit?: number
}

/** Interactions, most recent occurrence first. */
export function listInteractions(options: ListInteractionsOptions = {}): Promise<Interaction[]> {
  let query = db.selectFrom('interactions').selectAll()
  if (!options.includeArchived) {
    query = query.where('archivedAt', 'is', null)
  }
  query = query.orderBy('occurredAt', 'desc')
  if (options.limit !== undefined) {
    query = query.limit(options.limit)
  }
  return query.execute()
}

export function getInteraction(id: string): Promise<Interaction | undefined> {
  return db.selectFrom('interactions').selectAll().where('id', '=', id).executeTakeFirst()
}

/** The people linked to an interaction via `interaction_participants`. */
export function listInteractionParticipants(
  interactionId: string,
): Promise<InteractionParticipant[]> {
  return db
    .selectFrom('people')
    .innerJoin('interactionParticipants', 'interactionParticipants.personId', 'people.id')
    .where('interactionParticipants.interactionId', '=', interactionId)
    .selectAll('people')
    .execute()
}
