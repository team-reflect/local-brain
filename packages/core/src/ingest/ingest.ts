import type { Compilable } from 'kysely'
import { db } from '../db/client'
import { batch } from '../db/commands'
import { newId } from '../db/id'
import { type LinkEntityType, sourceLinkInsert } from '../extraction/source-links'
import { chunkText, normalizeText } from './chunk'
import { contentHash } from './hash'
import { markForExtraction } from './extraction-queue'
import { recomputeRelationshipIntelligence } from '../domains/relationships/recompute'
import { validateNewDocument } from '../domains/documents/validators'
import { validateNewInteraction } from '../domains/interactions/validators'

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

async function chunkStatements(
  recordType: 'document' | 'interaction',
  recordId: string,
  body: string,
): Promise<{
  statements: Compilable[]
  count: number
}> {
  const chunks = chunkText(body)
  // Store each chunk's text hash so the embedding-status count can compare it
  // against the embedded hash in SQL instead of re-hashing every chunk per poll.
  const statements = await Promise.all(
    chunks.map(async (chunk) =>
      db.insertInto('contentChunks').values({
        id: newId(),
        recordType,
        recordId,
        chunkIndex: chunk.index,
        text: chunk.text,
        contentHash: await contentHash(chunk.text),
      }),
    ),
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

  // Apply the same write contract as `createDocument` *before* the duplicate
  // short-circuit: normalize the title/body and reject a record with neither, so
  // a whitespace-only paste/import cannot return `isDuplicate` against an
  // existing empty-body hash instead of throwing. The chunk/hash path keeps
  // using the already-normalized `body` so dedupe keys stay identical to the
  // CLI's.
  const fields = validateNewDocument({
    title: input.title ?? null,
    bodyText: body,
    kind: input.kind ?? null,
    summary: input.summary ?? null,
    originalUrl: input.originalUrl ?? null,
  })

  if (dup && !input.allowDuplicate) return { id: dup, isDuplicate: true, chunkCount: 0 }

  const id = newId()
  const chunks = await chunkStatements('document', id, body)
  const statements: Compilable[] = [
    db.insertInto('documents').values({
      id,
      title: fields.title,
      kind: fields.kind ?? null,
      bodyText: fields.bodyText,
      summary: fields.summary ?? null,
      mimeType: input.mimeType ?? null,
      originalPath: input.originalPath ?? null,
      originalUrl: fields.originalUrl ?? null,
      authoredAt: input.authoredAt ?? null,
      contentHash: hash,
    }),
    ...chunks.statements,
    ...linkStatements('document', id, input.links),
  ]
  await batch(statements)
  markForExtraction('document', id)
  return { id, isDuplicate: Boolean(dup), chunkCount: chunks.count }
}

export async function ingestInteraction(input: IngestInteractionInput): Promise<IngestResult> {
  const { body, hash, dup } = await prepare('interactions', input)

  // Same write contract as `createInteraction` (mirrors `ingestDocument`):
  // normalize title/body and reject a record with neither, *before* the
  // duplicate short-circuit so a whitespace-only paste/import throws rather than
  // returning `isDuplicate` against an existing empty-body hash. `kind` is left
  // to the caller, as in the validator, since it is `NOT NULL DEFAULT 'note'`.
  const fields = validateNewInteraction({
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    title: input.title ?? null,
    bodyText: body,
    summary: input.summary ?? null,
    location: input.location ?? null,
    externalId: input.externalId ?? null,
    originalUrl: input.originalUrl ?? null,
  })

  if (dup && !input.allowDuplicate) return { id: dup, isDuplicate: true, chunkCount: 0 }

  const id = newId()
  const chunks = await chunkStatements('interaction', id, body)
  const statements: Compilable[] = [
    db.insertInto('interactions').values({
      id,
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      title: fields.title,
      bodyText: fields.bodyText,
      summary: fields.summary ?? null,
      occurredAt: input.occurredAt ?? null,
      location: fields.location ?? null,
      externalId: fields.externalId ?? null,
      originalPath: input.originalPath ?? null,
      originalUrl: fields.originalUrl ?? null,
      contentHash: hash,
    }),
    ...chunks.statements,
    ...linkStatements('interaction', id, input.links),
  ]
  await batch(statements)
  markForExtraction('interaction', id)
  // A new interaction refreshes its participants' relationship hints (step 9).
  for (const personId of input.links?.people ?? []) {
    await recomputeRelationshipIntelligence(personId)
  }
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

/** Map the plural {@link IngestLinks} keys to the shared entity-type names. */
const LINK_KEYS: ReadonlyArray<readonly [LinkEntityType, keyof IngestLinks]> = [
  ['person', 'people'],
  ['organization', 'organizations'],
  ['project', 'projects'],
  ['task', 'tasks'],
]

/**
 * Join-row inserts linking a source record to the user-picked entities, built
 * through the shared {@link sourceLinkInsert} topology so ingestion and the
 * extraction merge write identical rows.
 */
function linkStatements(
  recordType: 'document' | 'interaction',
  recordId: string,
  links: IngestLinks = {},
): Compilable[] {
  const statements: Compilable[] = []
  for (const [entityType, key] of LINK_KEYS) {
    for (const entityId of links[key] ?? []) {
      statements.push(sourceLinkInsert(recordType, recordId, entityType, entityId))
    }
  }
  return statements
}
