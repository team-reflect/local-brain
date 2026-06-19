import type { Interactions } from '@local-brain/db'
import { db } from '../../db/client'
import { batch } from '../../db/commands'
import { newId } from '../../db/id'
import { archiveRecord, updateRecord, type NewRecord, type RecordPatch } from '../../db/records'
import { recomputeRelationshipIntelligence } from '../relationships/recompute'
import { validateNewInteraction, validateInteractionPatch } from './validators'

export type NewInteraction = NewRecord<Interactions>
export type InteractionPatch = RecordPatch<Interactions>

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
  const values = validateNewInteraction(input)
  const id = newId()
  const statements = [
    db.insertInto('interactions').values({ ...values, id }),
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
  // Relationship hints update after a relevant interaction (Plan 05 step 9).
  // Runs after the interaction transaction commits so the recompute sees it.
  for (const participant of participants) {
    await recomputeRelationshipIntelligence(participant.personId)
  }
  return id
}

export function updateInteraction(id: string, patch: InteractionPatch): Promise<number> {
  return updateRecord('interactions', id, validateInteractionPatch(patch))
}

export function archiveInteraction(id: string): Promise<number> {
  return archiveRecord('interactions', id)
}
