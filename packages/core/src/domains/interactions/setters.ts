import type { Interactions } from '@local-brain/db'
import { db } from '../../db/client'
import { batch, execute } from '../../db/commands'
import { newId } from '../../db/id'
import type { NewRecord, RecordPatch } from '../../db/records'
import { nowIso } from '../../db/time'
import { recomputeRelationshipIntelligence } from '../relationships/recompute'

export type NewInteraction = NewRecord<Interactions>
export type InteractionPatch = RecordPatch<Interactions>

export interface InteractionParticipantInput {
  personId?: string
  role?: string
  handle?: string
  displayName?: string
  sourceId?: string
}

function normalizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function normalizeHandle(handle: string | undefined): string | undefined {
  const trimmed = handle?.trim()
  if (!trimmed) return undefined
  return trimmed.includes('@') ? trimmed.toLowerCase() : trimmed
}

interface ParticipantRow {
  id: string
  interactionId: string
  personId?: string
  role?: string
  handle?: string
  normalizedHandle?: string
  displayName?: string
  sourceId?: string
}

/**
 * Build the insert values for one participant, normalizing handle/display name.
 * Returns undefined when the row would carry no identity (no personId, handle,
 * or display name), since migration 0006's CHECK requires at least one of
 * person_id / normalized_handle / display_name to be present.
 */
function buildParticipantRow(
  interactionId: string,
  participant: InteractionParticipantInput,
): ParticipantRow | undefined {
  const personId = normalizeText(participant.personId)
  const role = normalizeText(participant.role)
  const handle = normalizeText(participant.handle)
  const normalizedHandle = normalizeHandle(participant.handle)
  const displayName = normalizeText(participant.displayName)
  if (personId === undefined && normalizedHandle === undefined && displayName === undefined) {
    return undefined
  }
  return {
    id: newId(),
    interactionId,
    ...(personId !== undefined ? { personId } : {}),
    ...(role !== undefined ? { role } : {}),
    ...(handle !== undefined ? { handle } : {}),
    ...(normalizedHandle !== undefined ? { normalizedHandle } : {}),
    ...(displayName !== undefined ? { displayName } : {}),
    ...(participant.sourceId !== undefined ? { sourceId: participant.sourceId } : {}),
  }
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
  const participantRows = participants
    .map((participant) => buildParticipantRow(id, participant))
    .filter((row): row is ParticipantRow => row !== undefined)
  const statements = [
    db.insertInto('interactions').values({ ...input, id }),
    ...participantRows.map((row) => db.insertInto('interactionParticipants').values(row)),
  ]
  await batch(statements)
  // Relationship hints update after a relevant interaction (Plan 05 step 9).
  // Runs after the interaction transaction commits so the recompute sees it.
  // Only the participants actually inserted (with a real personId) count.
  for (const row of participantRows) {
    if (row.personId !== undefined) {
      await recomputeRelationshipIntelligence(row.personId)
    }
  }
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
