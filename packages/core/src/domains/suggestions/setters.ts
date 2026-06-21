import type { Compilable } from 'kysely'
import { db } from '../../db/client'
import { batch, execute } from '../../db/commands'
import { newId } from '../../db/id'
import { nowIso } from '../../db/time'
import { normalizeDomain, normalizeName } from '../../text/normalize'
import type { SuggestionPayload } from './getters'

/** The record an accepted suggestion resolved to. */
export interface AcceptedSuggestion {
  recordType: 'project' | 'organization'
  recordId: string
}

function parsePayload(raw: string | null): SuggestionPayload {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as SuggestionPayload
  } catch {
    return {}
  }
}

/**
 * Dismiss an open suggestion. The `status = 'open'` guard makes this a no-op if a
 * concurrent accept/dismiss already resolved it (then we report it as such).
 */
export async function dismissSuggestion(id: string): Promise<void> {
  const affected = await execute(
    db
      .updateTable('suggestions')
      .set({ status: 'dismissed', resolvedAt: nowIso() })
      .where('id', '=', id)
      .where('status', '=', 'open'),
  )
  if (affected === 0) throw new Error('This suggestion is no longer open.')
}

/** An active project whose case-folded name matches, mirroring CLI dedupe. */
async function findProjectByName(name: string): Promise<string | null> {
  const key = normalizeName(name)
  const rows = await db
    .selectFrom('projects')
    .select(['id', 'name'])
    .where('archivedAt', 'is', null)
    .execute()
  return rows.find((row) => normalizeName(row.name) === key)?.id ?? null
}

/** An active org matching by case-folded name, then normalized domain (CLI parity). */
async function findOrganization(name: string, domain: string | null): Promise<string | null> {
  const key = normalizeName(name)
  const normDomain = normalizeDomain(domain)
  const rows = await db
    .selectFrom('organizations')
    .select(['id', 'name', 'domain'])
    .where('archivedAt', 'is', null)
    .execute()
  return (
    rows.find(
      (row) =>
        normalizeName(row.name) === key ||
        (normDomain != null && row.domain != null && normalizeDomain(row.domain) === normDomain),
    )?.id ?? null
  )
}

/** Resolve (or stage the creation of) the project a `create_project` accept targets. */
async function resolveProject(
  name: string,
  summary: string | null,
  stmts: Compilable[],
): Promise<string> {
  const existing = await findProjectByName(name)
  if (existing) return existing
  const id = newId()
  const now = nowIso()
  stmts.push(
    db.insertInto('projects').values({ id, name, status: 'active', summary, createdAt: now, updatedAt: now }),
  )
  return id
}

/** Resolve (or stage the creation of) the org an `create_organization` accept targets. */
async function resolveOrganization(
  name: string,
  domain: string | null,
  kind: string | null,
  stmts: Compilable[],
): Promise<string> {
  const existing = await findOrganization(name, domain)
  if (existing) return existing
  const id = newId()
  const now = nowIso()
  stmts.push(
    db
      .insertInto('organizations')
      .values({ id, name, domain: normalizeDomain(domain), kind, createdAt: now, updatedAt: now }),
  )
  return id
}

/** A statement relinking a cited record to the accepted project (or null to skip). */
function projectLinkStatement(
  projectId: string,
  recordType: string,
  recordId: string,
): Compilable | null {
  switch (recordType) {
    case 'interaction':
      return db
        .insertInto('projectInteractions')
        .values({ id: newId(), projectId, interactionId: recordId })
        .onConflict((oc) => oc.doNothing())
    case 'document':
      return db
        .insertInto('projectDocuments')
        .values({ id: newId(), projectId, documentId: recordId })
        .onConflict((oc) => oc.doNothing())
    case 'person':
      return db
        .insertInto('projectPeople')
        .values({ id: newId(), projectId, personId: recordId })
        .onConflict((oc) => oc.doNothing())
    case 'organization':
      return db
        .insertInto('projectOrganizations')
        .values({ id: newId(), projectId, organizationId: recordId })
        .onConflict((oc) => oc.doNothing())
    case 'task':
      // The project↔task relation lives on tasks.project_id.
      return db.updateTable('tasks').set({ projectId, updatedAt: nowIso() }).where('id', '=', recordId)
    default:
      return null
  }
}

/**
 * A statement relinking a cited record to the accepted org. Interactions,
 * documents, and projects get provenance links; people are intentionally skipped
 * — making a cited person an employee is a stronger claim (use `affiliate`).
 */
function organizationLinkStatement(
  organizationId: string,
  recordType: string,
  recordId: string,
): Compilable | null {
  switch (recordType) {
    case 'interaction':
      return db
        .insertInto('interactionOrganizations')
        .values({ id: newId(), organizationId, interactionId: recordId })
        .onConflict((oc) => oc.doNothing())
    case 'document':
      return db
        .insertInto('documentOrganizations')
        .values({ id: newId(), organizationId, documentId: recordId })
        .onConflict((oc) => oc.doNothing())
    case 'project':
      return db
        .insertInto('projectOrganizations')
        .values({ id: newId(), projectId: recordId, organizationId })
        .onConflict((oc) => oc.doNothing())
    default:
      return null
  }
}

/**
 * Accept a suggestion: find-or-create the proposed project/organization and relink
 * its cited records, then flip the suggestion to `accepted` — all in one Rust
 * transaction (`batch`). The `status = 'open'` guard on the final update is the
 * point of serialization against a concurrent resolve.
 */
export async function acceptSuggestion(id: string): Promise<AcceptedSuggestion> {
  const suggestion = await db
    .selectFrom('suggestions')
    .select(['kind', 'title', 'status', 'payloadJson'])
    .where('id', '=', id)
    .executeTakeFirst()
  if (!suggestion) throw new Error('Suggestion not found.')
  if (suggestion.status !== 'open') throw new Error('This suggestion is no longer open.')

  const payload = parsePayload(suggestion.payloadJson)
  const name = payload.name ?? suggestion.title
  const links = await db
    .selectFrom('suggestionLinks')
    .select(['recordType', 'recordId'])
    .where('suggestionId', '=', id)
    .orderBy('createdAt', 'asc')
    .execute()

  const stmts: Compilable[] = []
  let recordType: 'project' | 'organization'
  let recordId: string

  if (suggestion.kind === 'create_project') {
    recordType = 'project'
    recordId = await resolveProject(name, payload.summary ?? null, stmts)
    for (const link of links) {
      const stmt = projectLinkStatement(recordId, link.recordType, link.recordId)
      if (stmt) stmts.push(stmt)
    }
  } else if (suggestion.kind === 'create_organization') {
    recordType = 'organization'
    recordId = await resolveOrganization(name, payload.domain ?? null, payload.kind ?? null, stmts)
    for (const link of links) {
      const stmt = organizationLinkStatement(recordId, link.recordType, link.recordId)
      if (stmt) stmts.push(stmt)
    }
  } else {
    throw new Error(`Cannot accept a suggestion of kind '${suggestion.kind}'.`)
  }

  // Roll the WHOLE transaction back if the suggestion is no longer open. This
  // re-inserts the suggestion's own id (a primary-key collision) only when the
  // status is not 'open', so a concurrent dismiss/accept makes `db_batch` error
  // and undo the project/org creation and relinks — never a partial write.
  // When still open, the SELECT yields no row, so it's a no-op.
  stmts.unshift(
    db
      .insertInto('suggestions')
      .columns(['id', 'kind', 'title', 'status'])
      .expression(
        db
          .selectFrom('suggestions')
          .select(['id', 'kind', 'title', 'status'])
          .where('id', '=', id)
          .where('status', '!=', 'open'),
      ),
  )
  stmts.push(
    db
      .updateTable('suggestions')
      .set({
        status: 'accepted',
        resolvedRecordType: recordType,
        resolvedRecordId: recordId,
        resolvedAt: nowIso(),
      })
      .where('id', '=', id)
      .where('status', '=', 'open'),
  )

  try {
    await batch(stmts)
  } catch (cause) {
    throw new Error('This suggestion could not be accepted — it may have just been resolved.', {
      cause,
    })
  }
  return { recordType, recordId }
}
