import type { Compilable } from 'kysely'
import { db } from '../db/client'
import { batch } from '../db/commands'
import { newId } from '../db/id'
import { chunkText, normalizeText } from './chunk'
import { contentHash } from './hash'
import { markForExtraction } from './extraction-queue'

/**
 * Ingestion: turn pasted/imported text into a `document` or `interaction` with
 * readable body text, derived `content_chunks`, and optional links to people /
 * organizations / projects / tasks — all in one Rust transaction so a record is
 * never half-imported. Content is hashed (SHA-256) for duplicate detection.
 */

export interface IngestLinks {
  people?: readonly string[]
  organizations?: readonly string[]
  projects?: readonly string[]
  tasks?: readonly string[]
}

export interface IngestResult {
  id: string
  /** True when an un-archived record with the same content hash already existed. */
  isDuplicate: boolean
  /** Chunks written (0 when a duplicate was found and skipped). */
  chunkCount: number
}

interface BaseIngestInput {
  bodyText: string
  title?: string | null
  summary?: string | null
  originalPath?: string | null
  originalUrl?: string | null
  links?: IngestLinks
  /** Import anyway even if the content hash already exists (default: false). */
  allowDuplicate?: boolean
}

export interface IngestDocumentInput extends BaseIngestInput {
  kind?: string | null
  mimeType?: string | null
  authoredAt?: string | null
}

export interface IngestInteractionInput extends BaseIngestInput {
  kind?: string
  occurredAt?: string | null
  location?: string | null
  externalId?: string | null
}

function chunkStatements(recordType: 'document' | 'interaction', recordId: string, body: string): {
  statements: Compilable[]
  count: number
} {
  const chunks = chunkText(body)
  const statements = chunks.map((chunk) =>
    db.insertInto('contentChunks').values({
      id: newId(),
      recordType,
      recordId,
      chunkIndex: chunk.index,
      text: chunk.text,
    }),
  )
  return { statements, count: chunks.length }
}

/** Lookup an existing, non-archived record by content hash. */
async function findDuplicate(
  table: 'documents' | 'interactions',
  hash: string,
): Promise<string | undefined> {
  const row = await db
    .selectFrom(table)
    .select('id')
    .where('contentHash', '=', hash)
    .where('archivedAt', 'is', null)
    .limit(1)
    .executeTakeFirst()
  return row?.id
}

export async function ingestDocument(input: IngestDocumentInput): Promise<IngestResult> {
  const { body, hash, dup } = await prepare('documents', input)
  if (dup && !input.allowDuplicate) return { id: dup, isDuplicate: true, chunkCount: 0 }

  const id = newId()
  const chunks = chunkStatements('document', id, body)
  const statements: Compilable[] = [
    db.insertInto('documents').values({
      id,
      title: input.title ?? null,
      kind: input.kind ?? null,
      bodyText: body,
      summary: input.summary ?? null,
      mimeType: input.mimeType ?? null,
      originalPath: input.originalPath ?? null,
      originalUrl: input.originalUrl ?? null,
      authoredAt: input.authoredAt ?? null,
      contentHash: hash,
    }),
    ...chunks.statements,
    ...documentLinkStatements(id, input.links),
  ]
  await batch(statements)
  markForExtraction('document', id)
  return { id, isDuplicate: Boolean(dup), chunkCount: chunks.count }
}

export async function ingestInteraction(input: IngestInteractionInput): Promise<IngestResult> {
  const { body, hash, dup } = await prepare('interactions', input)
  if (dup && !input.allowDuplicate) return { id: dup, isDuplicate: true, chunkCount: 0 }

  const id = newId()
  const chunks = chunkStatements('interaction', id, body)
  const statements: Compilable[] = [
    db.insertInto('interactions').values({
      id,
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      title: input.title ?? null,
      bodyText: body,
      summary: input.summary ?? null,
      occurredAt: input.occurredAt ?? null,
      location: input.location ?? null,
      externalId: input.externalId ?? null,
      originalPath: input.originalPath ?? null,
      originalUrl: input.originalUrl ?? null,
      contentHash: hash,
    }),
    ...chunks.statements,
    ...interactionLinkStatements(id, input.links),
  ]
  await batch(statements)
  markForExtraction('interaction', id)
  return { id, isDuplicate: Boolean(dup), chunkCount: chunks.count }
}

async function prepare(
  table: 'documents' | 'interactions',
  input: BaseIngestInput,
): Promise<{ body: string; hash: string; dup: string | undefined }> {
  const body = normalizeText(input.bodyText)
  const hash = await contentHash(body)
  const dup = await findDuplicate(table, hash)
  return { body, hash, dup }
}

function documentLinkStatements(documentId: string, links: IngestLinks = {}): Compilable[] {
  const statements: Compilable[] = []
  for (const personId of links.people ?? []) {
    statements.push(db.insertInto('documentPeople').values({ id: newId(), documentId, personId }))
  }
  for (const organizationId of links.organizations ?? []) {
    statements.push(
      db.insertInto('documentOrganizations').values({ id: newId(), documentId, organizationId }),
    )
  }
  for (const projectId of links.projects ?? []) {
    statements.push(db.insertInto('projectDocuments').values({ id: newId(), projectId, documentId }))
  }
  for (const taskId of links.tasks ?? []) {
    statements.push(db.insertInto('taskDocuments').values({ id: newId(), taskId, documentId }))
  }
  return statements
}

function interactionLinkStatements(interactionId: string, links: IngestLinks = {}): Compilable[] {
  const statements: Compilable[] = []
  for (const personId of links.people ?? []) {
    statements.push(
      db.insertInto('interactionParticipants').values({ id: newId(), interactionId, personId }),
    )
  }
  for (const organizationId of links.organizations ?? []) {
    statements.push(
      db
        .insertInto('interactionOrganizations')
        .values({ id: newId(), interactionId, organizationId }),
    )
  }
  for (const projectId of links.projects ?? []) {
    statements.push(
      db.insertInto('projectInteractions').values({ id: newId(), projectId, interactionId }),
    )
  }
  for (const taskId of links.tasks ?? []) {
    statements.push(
      db.insertInto('taskInteractions').values({ id: newId(), taskId, interactionId }),
    )
  }
  return statements
}
