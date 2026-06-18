import type { Insertable, Updateable } from 'kysely'
import type { Interactions } from '@local-brain/db'
import { db } from '../../db/client'
import { batch, execute } from '../../db/commands'
import { newId } from '../../db/id'
import { nowIso } from '../../db/time'

export type NewInteraction = Omit<Insertable<Interactions>, 'id' | 'createdAt' | 'updatedAt'>
export type InteractionPatch = Omit<Updateable<Interactions>, 'id' | 'createdAt'>

export interface InteractionParticipantInput {
  personId: string
  role?: string
}

/**
 * Create an interaction and, in the SAME Rust transaction, its participant
 * links. A multi-table write: if any participant insert fails, the interaction
 * insert rolls back too (see `db_batch`).
 */
export async function createInteraction(
  input: NewInteraction,
  participants: readonly InteractionParticipantInput[] = [],
): Promise<string> {
  const id = newId()
  const statements = [
    db.insertInto('interactions').values({ ...input, id }),
    ...participants.map((participant) =>
      db.insertInto('interactionParticipants').values({
        id: newId(),
        interactionId: id,
        personId: participant.personId,
        ...(participant.role !== undefined ? { role: participant.role } : {}),
      }),
    ),
  ]
  await batch(statements)
  return id
}

export function updateInteraction(id: string, patch: InteractionPatch): Promise<number> {
  return execute(
    db
      .updateTable('interactions')
      .set({ ...patch, updatedAt: nowIso() })
      .where('id', '=', id),
  )
}

export function archiveInteraction(id: string): Promise<number> {
  return execute(
    db
      .updateTable('interactions')
      .set({ archivedAt: nowIso(), updatedAt: nowIso() })
      .where('id', '=', id),
  )
}
