import type { Memories, MemoryLinks } from '@local-brain/db'
import { db } from '../../db/client'
import { batch, execute } from '../../db/commands'
import { newId } from '../../db/id'
import type { NewRecord, RecordPatch } from '../../db/records'
import { nowIso } from '../../db/time'
import { requireText } from '../../validation'
import { squish, trimToNull } from '../../text/normalize'

/**
 * Correction setters for hidden memories (Plan 05 step 8). Extraction creates
 * memories and `memory_links`; here the user fixes them where they notice a
 * mistake: edit a claim, archive a wrong memory, or unlink it from a record it
 * does not actually concern. Every write is one statement through the Rust-owned
 * connection. Memories are never hard-deleted — archiving keeps provenance and
 * any evidence intact.
 */

export type MemoryPatch = RecordPatch<Memories>
export type NewMemory = NewRecord<Memories>

export interface MemoryLinkInput {
  recordType: string
  recordId: string
  role?: string | null
}

export interface CreatedMemory {
  id: string
  created: boolean
}

type MemoryLinkValues = Pick<MemoryLinks, 'recordType' | 'recordId' | 'role'>

function normalizeClaim(claim: string): string {
  return squish(requireText('claim', claim))
}

function normalizeMemory(input: NewMemory): NewMemory {
  const out: NewMemory = { ...input, claim: normalizeClaim(input.claim) }
  if (input.kind !== undefined) out.kind = trimToNull(input.kind) ?? undefined
  return out
}

function memoryClaimKey(claim: string): string {
  return claim.trim().toLowerCase()
}

function normalizeMemoryLink(link: MemoryLinkInput): MemoryLinkValues {
  return {
    recordType: requireText('recordType', link.recordType),
    recordId: requireText('recordId', link.recordId),
    role: trimToNull(link.role ?? null),
  }
}

function memoryLinkKey(link: MemoryLinkValues): string {
  return `${link.recordType}\0${link.recordId}\0${link.role ?? ''}`
}

async function findActiveMemoryByClaim(claim: string): Promise<string | null> {
  const key = memoryClaimKey(claim)
  const rows = await db
    .selectFrom('memories')
    .select(['id', 'claim'])
    .where('archivedAt', 'is', null)
    .execute()
  return rows.find((row) => memoryClaimKey(row.claim) === key)?.id ?? null
}

async function addMissingMemoryLinks(
  memoryId: string,
  links: readonly MemoryLinkValues[],
): Promise<void> {
  if (links.length === 0) return

  const existing = await db
    .selectFrom('memoryLinks')
    .select(['recordType', 'recordId', 'role'])
    .where('memoryId', '=', memoryId)
    .execute()
  const existingKeys = new Set(existing.map(memoryLinkKey))
  const missing = links.filter((link) => !existingKeys.has(memoryLinkKey(link)))
  if (missing.length === 0) return

  await batch(
    missing.map((link) =>
      db.insertInto('memoryLinks').values({
        id: newId(),
        memoryId,
        recordType: link.recordType,
        recordId: link.recordId,
        role: link.role,
      }),
    ),
  )
}

/**
 * Create a durable memory and optional subject links. Exact active duplicate
 * claims return the existing memory id instead of inserting a second row, while
 * still applying any requested links that are not already present.
 */
export async function createMemory(
  input: NewMemory,
  links: readonly MemoryLinkInput[] = [],
): Promise<CreatedMemory> {
  const values = normalizeMemory(input)
  const normalizedLinks = links.map(normalizeMemoryLink)
  const existingId = await findActiveMemoryByClaim(values.claim)
  if (existingId) {
    await addMissingMemoryLinks(existingId, normalizedLinks)
    return { id: existingId, created: false }
  }

  const id = newId()
  await batch([
    db.insertInto('memories').values({ ...values, id }),
    ...normalizedLinks.map((link) =>
      db.insertInto('memoryLinks').values({
        id: newId(),
        memoryId: id,
        recordType: link.recordType,
        recordId: link.recordId,
        role: link.role ?? null,
      }),
    ),
  ])
  return { id, created: true }
}

/** Edit a memory's claim / kind / confidence / validity window. */
export function updateMemory(id: string, patch: MemoryPatch): Promise<number> {
  return execute(
    db
      .updateTable('memories')
      .set({ ...patch, updatedAt: nowIso() })
      .where('id', '=', id),
  )
}

/** Soft-delete a memory; its links and evidence stay for the record. */
export function archiveMemory(id: string): Promise<number> {
  return execute(
    db
      .updateTable('memories')
      .set({ archivedAt: nowIso(), updatedAt: nowIso() })
      .where('id', '=', id),
  )
}

/**
 * Remove a memory's link to a record (e.g. the memory is real but does not
 * concern this person). Deletes only the matching `memory_links` row(s); the
 * memory and its other links survive. Resolves to the number of links removed.
 */
export function unlinkMemoryFromRecord(
  memoryId: string,
  recordType: string,
  recordId: string,
): Promise<number> {
  return execute(
    db
      .deleteFrom('memoryLinks')
      .where('memoryId', '=', memoryId)
      .where('recordType', '=', recordType)
      .where('recordId', '=', recordId),
  )
}

/** Link an existing memory to a record (the inverse of {@link unlinkMemoryFromRecord}). */
export function linkMemoryToRecord(
  memoryId: string,
  recordType: string,
  recordId: string,
  role: string | null = null,
): Promise<number> {
  return execute(
    db.insertInto('memoryLinks').values({ id: newId(), memoryId, recordType, recordId, role }),
  )
}
