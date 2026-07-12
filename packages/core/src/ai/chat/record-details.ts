import type { Selectable } from 'kysely'
import type { ContentChunks } from '@local-brain/db'
import { db } from '../../db/client'
import type { SourceRecordType } from '../../retrieval/retrieve'
import { recordSummary } from './record-summaries'

/** Default chunk-text budget allocated to one Chat record detail. */
export const DEFAULT_RECORD_DETAIL_CHARS = 4000
/** Hard per-record chunk-text budget accepted by the Chat read tool. */
export const MAX_RECORD_DETAIL_CHARS = 12000
/** Default aggregate chunk-text budget for one batched Chat detail read. */
export const DEFAULT_RECORD_DETAIL_TOTAL_CHARS = 24000
/** Hard aggregate chunk-text budget accepted by the Chat read tool. */
export const MAX_RECORD_DETAIL_TOTAL_CHARS = 32000

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
  recordRef: string
  found: boolean
  title: string | null
  date: string | null
  metadata: Record<string, unknown>
  chunks: ChatRecordChunk[]
  truncated: boolean
}

type ContentChunk = Pick<Selectable<ContentChunks>, 'id' | 'chunkIndex' | 'text'>

/** Per-record and aggregate chunk-text budgets for a batched detail read. */
export interface ChatRecordDetailOptions {
  /** Maximum chunk-text characters allocated to any one record. */
  maxCharsPerRecord?: number
  /** Maximum chunk-text characters allocated across the whole call. */
  maxTotalChars?: number
}

function boundedLimit(raw: number | undefined, fallback: number, maximum: number): number {
  return Math.min(Math.max(raw ?? fallback, 1), maximum)
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

function fitFocusedChunks(
  rows: readonly ContentChunk[],
  chunkIds: readonly string[],
  maxChars: number,
): { chunks: ChatRecordChunk[]; truncatedByBudget: boolean } {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const requested = [...new Set(chunkIds)]
    .map((id) => byId.get(id))
    .filter((row): row is ContentChunk => row !== undefined)
  const requestedIds = new Set(requested.map((row) => row.id))
  const allocations = new Map(requested.map((row) => [row.id, 0]))
  let remaining = maxChars
  let pending = requested.filter((row) => row.text.length > 0)

  // Water-fill the requested chunks so no first large chunk can starve later
  // explicit evidence. At very small budgets a chunk may carry an empty
  // excerpt, but its stable id still survives for citation/inspection.
  while (remaining > 0 && pending.length > 0) {
    const share = Math.max(1, Math.floor(remaining / pending.length))
    for (const row of pending) {
      if (remaining <= 0) break
      const current = allocations.get(row.id) ?? 0
      const addition = Math.min(row.text.length - current, share, remaining)
      allocations.set(row.id, current + addition)
      remaining -= addition
    }
    pending = pending.filter((row) => (allocations.get(row.id) ?? 0) < row.text.length)
  }

  const requestedChunks = requested.map((row) => ({
    chunkId: row.id,
    chunkIndex: row.chunkIndex,
    text: row.text.slice(0, allocations.get(row.id) ?? 0),
  }))
  const neighbours = rows.filter((row) => !requestedIds.has(row.id))
  const fittedNeighbours = fitChunks(neighbours, remaining)
  return {
    chunks: [...requestedChunks, ...fittedNeighbours.chunks],
    truncatedByBudget:
      requested.some((row) => (allocations.get(row.id) ?? 0) < row.text.length) ||
      fittedNeighbours.truncatedByBudget,
  }
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
  const fitted =
    request.chunkIds && request.chunkIds.length > 0
      ? fitFocusedChunks(rows, request.chunkIds, maxChars)
      : fitChunks(rows, maxChars)
  return {
    chunks: fitted.chunks.sort((a, b) => a.chunkIndex - b.chunkIndex),
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
      recordRef: `${request.recordType}:${request.recordId}`,
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
    recordRef: `${request.recordType}:${request.recordId}`,
    found: true,
    title: summary.title,
    date: summary.date,
    metadata: summary.metadata,
    chunks: chunks.chunks,
    truncated: chunks.truncated,
  }
}

/** Load structured records while enforcing both per-record and per-call text budgets. */
export function getChatRecords(
  requests: readonly ChatRecordRequest[],
  options: ChatRecordDetailOptions = {},
): Promise<ChatRecordDetail[]> {
  const maxPerRecord = boundedLimit(
    options.maxCharsPerRecord,
    DEFAULT_RECORD_DETAIL_CHARS,
    MAX_RECORD_DETAIL_CHARS,
  )
  const maxTotal = boundedLimit(
    options.maxTotalChars,
    DEFAULT_RECORD_DETAIL_TOTAL_CHARS,
    MAX_RECORD_DETAIL_TOTAL_CHARS,
  )
  let remaining = maxTotal
  const budgets = requests.map((_request, index) => {
    const requestsLeft = requests.length - index
    const fairShare = Math.floor(remaining / requestsLeft)
    const allocation = Math.min(maxPerRecord, fairShare)
    remaining -= allocation
    return allocation
  })
  return Promise.all(requests.map((request, index) => getChatRecord(request, budgets[index] ?? 0)))
}
