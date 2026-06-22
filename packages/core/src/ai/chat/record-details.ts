import type { Selectable } from 'kysely'
import type { ContentChunks } from '@local-brain/db'
import { db } from '../../db/client'
import type { SourceRecordType } from '../../retrieval/retrieve'
import { recordSummary } from './record-summaries'

export const DEFAULT_RECORD_DETAIL_CHARS = 4000
export const MAX_RECORD_DETAIL_CHARS = 12000

export interface ChatRecordRequest {
  recordType: SourceRecordType
  recordId: string
  chunkIds?: readonly string[]
}

export interface ChatRecordChunk {
  chunkId: string
  chunkIndex: number
  text: string
}

export interface ChatRecordDetail {
  recordType: SourceRecordType
  recordId: string
  found: boolean
  title: string | null
  date: string | null
  metadata: Record<string, unknown>
  chunks: ChatRecordChunk[]
  truncated: boolean
}

type ContentChunk = Pick<Selectable<ContentChunks>, 'id' | 'chunkIndex' | 'text'>

function limitFor(options: { maxCharsPerRecord?: number }): number {
  const raw = options.maxCharsPerRecord ?? DEFAULT_RECORD_DETAIL_CHARS
  return Math.min(Math.max(raw, 1), MAX_RECORD_DETAIL_CHARS)
}

async function chunkCount(recordType: SourceRecordType, recordId: string): Promise<number> {
  const row = await db
    .selectFrom('contentChunks')
    .select(({ fn }) => fn.countAll<number>().as('count'))
    .where('recordType', '=', recordType)
    .where('recordId', '=', recordId)
    .executeTakeFirst()
  return Number(row?.count ?? 0)
}

async function chunksByRecord(recordType: SourceRecordType, recordId: string): Promise<ContentChunk[]> {
  return db
    .selectFrom('contentChunks')
    .select(['id', 'chunkIndex', 'text'])
    .where('recordType', '=', recordType)
    .where('recordId', '=', recordId)
    .orderBy('chunkIndex', 'asc')
    .execute()
}

async function chunksAroundIds(
  recordType: SourceRecordType,
  recordId: string,
  chunkIds: readonly string[],
): Promise<ContentChunk[]> {
  const direct = await db
    .selectFrom('contentChunks')
    .select('chunkIndex')
    .where('recordType', '=', recordType)
    .where('recordId', '=', recordId)
    .where('id', 'in', [...chunkIds])
    .execute()

  const indices = new Set<number>()
  for (const { chunkIndex } of direct) {
    if (chunkIndex > 0) indices.add(chunkIndex - 1)
    indices.add(chunkIndex)
    indices.add(chunkIndex + 1)
  }
  if (indices.size === 0) return []

  return db
    .selectFrom('contentChunks')
    .select(['id', 'chunkIndex', 'text'])
    .where('recordType', '=', recordType)
    .where('recordId', '=', recordId)
    .where('chunkIndex', 'in', [...indices])
    .orderBy('chunkIndex', 'asc')
    .execute()
}

function fitChunks(rows: readonly ContentChunk[], maxChars: number): {
  chunks: ChatRecordChunk[]
  truncatedByBudget: boolean
} {
  let remaining = maxChars
  const chunks: ChatRecordChunk[] = []

  for (const row of rows) {
    if (remaining <= 0) return { chunks, truncatedByBudget: true }
    const text = row.text.length > remaining ? row.text.slice(0, remaining) : row.text
    chunks.push({ chunkId: row.id, chunkIndex: row.chunkIndex, text })
    if (row.text.length > remaining) return { chunks, truncatedByBudget: true }
    remaining -= row.text.length
  }

  return { chunks, truncatedByBudget: false }
}

async function recordChunks(
  request: ChatRecordRequest,
  maxChars: number,
): Promise<{ chunks: ChatRecordChunk[]; truncated: boolean }> {
  const total = await chunkCount(request.recordType, request.recordId)
  const rows =
    request.chunkIds && request.chunkIds.length > 0
      ? await chunksAroundIds(request.recordType, request.recordId, request.chunkIds)
      : await chunksByRecord(request.recordType, request.recordId)
  const fitted = fitChunks(rows, maxChars)
  return {
    chunks: fitted.chunks,
    truncated: fitted.truncatedByBudget || total > fitted.chunks.length,
  }
}

async function getChatRecord(
  request: ChatRecordRequest,
  maxChars: number,
): Promise<ChatRecordDetail> {
  const summary = await recordSummary(request.recordType, request.recordId)
  if (!summary) {
    return {
      recordType: request.recordType,
      recordId: request.recordId,
      found: false,
      title: null,
      date: null,
      metadata: {},
      chunks: [],
      truncated: false,
    }
  }

  const chunks = await recordChunks(request, maxChars)
  return {
    recordType: request.recordType,
    recordId: request.recordId,
    found: true,
    title: summary.title,
    date: summary.date,
    metadata: summary.metadata,
    chunks: chunks.chunks,
    truncated: chunks.truncated,
  }
}

export function getChatRecords(
  requests: readonly ChatRecordRequest[],
  options: { maxCharsPerRecord?: number } = {},
): Promise<ChatRecordDetail[]> {
  const maxChars = limitFor(options)
  return Promise.all(requests.map((request) => getChatRecord(request, maxChars)))
}
