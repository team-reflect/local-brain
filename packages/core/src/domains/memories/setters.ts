import type { Memories, MemoryLinks } from '@local-brain/db'
import { db, dbForDatabase } from '../../db/client'
import { batch, execute } from '../../db/commands'
import { activeDatabaseIdentity, type DatabaseIdentity } from '../../db/identity'
import { newId } from '../../db/id'
import type { NewRecord, RecordPatch } from '../../db/records'
import { nowIso } from '../../db/time'
import { contentChunkProjection } from '../../ingest/content-projection'
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
let memoryWriteLock: Promise<void> = Promise.resolve()

function normalizeClaim(claim: string): string {
  return squish(requireText('claim', claim))
}

function normalizeMemory(input: NewMemory): NewMemory {
  const out: NewMemory = { ...input, claim: normalizeClaim(input.claim) }
  if (input.kind !== undefined) out.kind = trimToNull(input.kind) ?? undefined
  return out
}

function memoryClaimKey(claim: string): string {
  return squish(claim).toLowerCase()
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

async function findActiveMemoryByClaim(
  claim: string,
  expectedIdentity?: DatabaseIdentity,
): Promise<string | null> {
  const key = memoryClaimKey(claim)
  const readDb = expectedIdentity ? dbForDatabase(expectedIdentity) : db
  const rows = await readDb
    .selectFrom('memories')
    .select(['id', 'claim'])
    .where('archivedAt', 'is', null)
    .execute()
  return rows.find((row) => memoryClaimKey(row.claim) === key)?.id ?? null
}

async function addMissingMemoryLinks(
  memoryId: string,
  links: readonly MemoryLinkValues[],
  expectedIdentity: DatabaseIdentity,
): Promise<void> {
  if (links.length === 0) return

  const existing = await dbForDatabase(expectedIdentity)
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
    expectedIdentity,
  )
}

async function runMemoryWriteExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = memoryWriteLock.then(fn, fn)
  memoryWriteLock = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/**
 * Create a durable memory and optional subject links. Exact active duplicate
 * claims return the existing memory id instead of inserting a second row, while
 * still applying any requested links that are not already present. The memory,
 * claim chunks, and links are written against one captured brain identity.
 */
export function createMemory(
  input: NewMemory,
  links: readonly MemoryLinkInput[] = [],
  expectedIdentity?: DatabaseIdentity,
): Promise<CreatedMemory> {
  return runMemoryWriteExclusive(() => createMemoryUnlocked(input, links, expectedIdentity))
}

async function createMemoryUnlocked(
  input: NewMemory,
  links: readonly MemoryLinkInput[],
  expectedIdentity?: DatabaseIdentity,
): Promise<CreatedMemory> {
  const identity = expectedIdentity ?? (await activeDatabaseIdentity())
  const values = normalizeMemory(input)
  const normalizedLinks = links.map(normalizeMemoryLink)
  const existingId = await findActiveMemoryByClaim(values.claim, identity)
  if (existingId) {
    await addMissingMemoryLinks(existingId, normalizedLinks, identity)
    const projection = await contentChunkProjection('memory', existingId, values.claim, {
      databaseIdentity: identity,
    })
    await batch(projection.statements, identity)
    return { id: existingId, created: false }
  }

  const id = newId()
  const projection = await contentChunkProjection('memory', id, values.claim, {
    databaseIdentity: identity,
    readExisting: false,
  })
  await batch([
    db.insertInto('memories').values({ ...values, id }),
    ...projection.statements,
    ...normalizedLinks.map((link) =>
      db.insertInto('memoryLinks').values({
        id: newId(),
        memoryId: id,
        recordType: link.recordType,
        recordId: link.recordId,
        role: link.role ?? null,
      }),
    ),
  ], identity)
  return { id, created: true }
}

/**
 * Edit a memory's claim/kind/confidence/validity window. Claim changes refresh
 * chunks atomically; a supplied identity rejects work after a brain switch.
 */
export function updateMemory(
  id: string,
  patch: MemoryPatch,
  expectedIdentity?: DatabaseIdentity,
): Promise<number> {
  return runMemoryWriteExclusive(async () => {
    const identity = expectedIdentity ?? (await activeDatabaseIdentity())
    const values: MemoryPatch = { ...patch }
    if (patch.claim !== undefined) {
      values.claim = normalizeClaim(patch.claim)
      const duplicateId = await findActiveMemoryByClaim(values.claim, identity)
      if (duplicateId && duplicateId !== id) {
        throw new Error('An active memory with this claim already exists.')
      }
    }
    if (values.claim === undefined) {
      return execute(
        db
          .updateTable('memories')
          .set({ ...values, updatedAt: nowIso() })
          .where('id', '=', id),
        identity,
      )
    }
    const existing = await dbForDatabase(identity)
      .selectFrom('memories')
      .select('id')
      .where('id', '=', id)
      .executeTakeFirst()
    if (!existing) {
      return execute(
        db
          .updateTable('memories')
          .set({ ...values, updatedAt: nowIso() })
          .where('id', '=', id),
        identity,
      )
    }

    const projection = await contentChunkProjection('memory', id, values.claim, {
      databaseIdentity: identity,
    })
    const [affected] = await batch([
      db
        .updateTable('memories')
        .set({ ...values, updatedAt: nowIso() })
        .where('id', '=', id),
      ...projection.statements,
    ], identity)
    return affected ?? 0
  })
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
