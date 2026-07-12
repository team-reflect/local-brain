import type { Interactions } from '@local-brain/db'
import { db, dbForDatabase } from '../../db/client'
import { batch } from '../../db/commands'
import { activeDatabaseIdentity, type DatabaseIdentity } from '../../db/identity'
import { newId } from '../../db/id'
import {
  archiveRecord,
  assertTitleOrBody,
  updateRecord,
  type NewRecord,
  type RecordPatch,
} from '../../db/records'
import { nowIso } from '../../db/time'
import { contentChunkProjection } from '../../ingest/content-projection'
import { recomputeRelationshipIntelligence } from '../relationships/recompute'
import { validateNewInteraction, validateInteractionPatch } from './validators'

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
 * Identity key matching migration 0006's unique indexes plus the CLI's name-only
 * guard, so two participant inputs that would collapse to the same row dedupe to
 * one. Person rows key on `(interactionId, personId)`; handle rows on
 * `(interactionId, normalizedHandle, role)`; name-only rows on
 * `(interactionId, displayName, role)`. The DB only enforces uniqueness for the
 * first two — name-only rows have no covering index — so without this dedupe the
 * desktop batch path would persist duplicate identical unresolved participants
 * in a single create (the CLI guards the same case on re-import).
 */
function participantIdentityKey(row: ParticipantRow): string {
  if (row.personId !== undefined) return `person\u0000${row.personId}`
  const role = row.role ?? ''
  if (row.normalizedHandle !== undefined) return `handle\u0000${row.normalizedHandle}\u0000${role}`
  return `name\u0000${row.displayName ?? ''}\u0000${role}`
}

/**
 * Create an interaction, body chunks, and participant links in one Rust
 * transaction pinned to the captured brain. Any failed statement rolls the
 * whole multi-table write back (see `db_batch`).
 */
export async function createInteraction(
  input: NewInteraction,
  participants: readonly InteractionParticipantInput[] = [],
  expectedIdentity?: DatabaseIdentity,
): Promise<string> {
  const values = validateNewInteraction(input)
  const identity = expectedIdentity ?? (await activeDatabaseIdentity())
  const id = newId()
  const seen = new Set<string>()
  const participantRows = participants
    .map((participant) => buildParticipantRow(id, participant))
    .filter((row): row is ParticipantRow => row !== undefined)
    .filter((row) => {
      const key = participantIdentityKey(row)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  const projection = await contentChunkProjection('interaction', id, values.bodyText, {
    databaseIdentity: identity,
    readExisting: false,
  })
  const statements = [
    db.insertInto('interactions').values({ ...values, id }),
    ...projection.statements,
    ...participantRows.map((row) => db.insertInto('interactionParticipants').values(row)),
  ]
  await batch(statements, identity)
  // Relationship hints update after a relevant interaction (Plan 05 step 9).
  // Runs after the interaction transaction commits so the recompute sees it.
  // Only the participants actually inserted (with a real personId) count.
  for (const row of participantRows) {
    if (row.personId !== undefined) {
      await recomputeRelationshipIntelligence(row.personId, { databaseIdentity: identity })
    }
  }
  return id
}

/**
 * Update an interaction, refreshing body chunks atomically when body text
 * changes. A supplied identity rejects stale work after a brain switch.
 */
export async function updateInteraction(
  id: string,
  patch: InteractionPatch,
  expectedIdentity?: DatabaseIdentity,
): Promise<number> {
  const clean = validateInteractionPatch(patch)
  const identity = expectedIdentity ?? (await activeDatabaseIdentity())
  await assertTitleOrBody('interactions', id, clean, 'an interaction', identity)
  if (clean.bodyText === undefined) return updateRecord('interactions', id, clean, identity)
  const existing = await dbForDatabase(identity)
    .selectFrom('interactions')
    .select('id')
    .where('id', '=', id)
    .executeTakeFirst()
  if (!existing) {
    const [affected] = await batch([
      db.updateTable('interactions').set({ ...clean, updatedAt: nowIso() }).where('id', '=', id),
    ], identity)
    return affected ?? 0
  }

  const projection = await contentChunkProjection('interaction', id, clean.bodyText, {
    databaseIdentity: identity,
  })
  const [affected] = await batch([
    db.updateTable('interactions').set({ ...clean, updatedAt: nowIso() }).where('id', '=', id),
    ...projection.statements,
  ], identity)
  return affected ?? 0
}

export function archiveInteraction(id: string): Promise<number> {
  return archiveRecord('interactions', id)
}
