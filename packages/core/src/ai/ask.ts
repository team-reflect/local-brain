import { db } from '../db/client'
import { batch, execute } from '../db/commands'
import { newId } from '../db/id'
import { nowIso } from '../db/time'
import { retrieve, type RetrievalMode, type RetrievedChunk } from '../retrieval/retrieve'
import { getModelStatus, type ModelStatus } from './boundary'
import { assembleAnswerContext, citedSubset, type Citation } from './context'
import { getModelProvider } from './provider'

/**
 * Ask: the cited-answer pipeline (Plan 06, steps 8–12). Retrieve grounding
 * chunks via the shared {@link retrieve} contract, assemble them through the one
 * checked context helper, call the registered provider, then persist the answer
 * and one `evidence_refs` row per cited source so the UI/CLI can open the exact
 * document or interaction the answer relied on.
 *
 * When the model boundary is closed (no provider/key, or external calls
 * disabled) it does NOT call a model: it persists an honest, clearly-labelled
 * message and returns `answered: false`. The conversation still reads as a real
 * thread, and the failure reason is explicit.
 */

export interface AskCitation extends Citation {
  /** The full cited chunk text. */
  chunkText: string
  snippet: string
}

export interface AskResult {
  conversationId: string
  /** The assistant message id. */
  messageId: string
  answer: string
  /** `false` when the boundary was closed and no model was called. */
  answered: boolean
  model: string | null
  citations: AskCitation[]
  status: ModelStatus
}

export interface AskOptions {
  conversationId?: string
  mode?: RetrievalMode
  /** Max grounding chunks to retrieve. */
  limit?: number
  boostRecordIds?: readonly string[]
  now?: Date
}

async function ensureConversation(question: string, conversationId?: string): Promise<string> {
  if (conversationId) return conversationId
  const id = newId()
  const title = question.length > 60 ? `${question.slice(0, 59)}…` : question
  await execute(db.insertInto('chatConversations').values({ id, title }))
  return id
}

async function persistUserTurn(conversationId: string, content: string): Promise<void> {
  await batch([
    db.insertInto('chatMessages').values({ id: newId(), conversationId, role: 'user', content }),
    db.updateTable('chatConversations').set({ updatedAt: nowIso() }).where('id', '=', conversationId),
  ])
}

async function persistAssistantTurn(
  conversationId: string,
  content: string,
  model: string | null,
  citations: readonly AskCitation[],
): Promise<string> {
  const messageId = newId()
  await batch([
    db.insertInto('chatMessages').values({
      id: messageId,
      conversationId,
      role: 'assistant',
      content,
      ...(model ? { model } : {}),
    }),
    db.updateTable('chatConversations').set({ updatedAt: nowIso() }).where('id', '=', conversationId),
    ...citations.map((citation) =>
      db.insertInto('evidenceRefs').values({
        id: newId(),
        subjectType: 'chat_message',
        subjectId: messageId,
        chunkId: citation.chunkId,
        note: citation.recordTitle,
      }),
    ),
  ])
  return messageId
}

const CLOSED_BOUNDARY_PREFIX = 'I can’t answer yet —'
const PROVIDER_ERROR_PREFIX = 'I couldn’t complete that —'

function toCitation(chunk: RetrievedChunk, base: Citation): AskCitation {
  return { ...base, chunkText: chunk.text, snippet: chunk.snippet }
}

export async function ask(question: string, options: AskOptions = {}): Promise<AskResult> {
  const text = question.trim()
  const conversationId = await ensureConversation(text, options.conversationId)
  await persistUserTurn(conversationId, text)

  const status = await getModelStatus()
  if (!status.canRun) {
    const content = `${CLOSED_BOUNDARY_PREFIX} ${status.reason}`
    const messageId = await persistAssistantTurn(conversationId, content, null, [])
    return { conversationId, messageId, answer: content, answered: false, model: null, citations: [], status }
  }

  const retrieval = await retrieve(text, {
    ...(options.mode !== undefined ? { mode: options.mode } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.boostRecordIds !== undefined ? { boostRecordIds: options.boostRecordIds } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  })
  const assembled = assembleAnswerContext(text, retrieval.chunks)

  const provider = getModelProvider()
  // getModelStatus already proved a provider is present and available.
  let completion
  try {
    completion = await provider!.generate(assembled.request)
  } catch (error) {
    // A provider failure (network, auth, rate limit) must not leave the user turn
    // orphaned with no reply: persist an honest assistant turn and degrade, the
    // same way a closed boundary does, so the thread reads as complete.
    const detail = error instanceof Error ? error.message : String(error)
    const content = `${PROVIDER_ERROR_PREFIX} the model request failed (${detail}).`
    const messageId = await persistAssistantTurn(conversationId, content, null, [])
    return { conversationId, messageId, answer: content, answered: false, model: null, citations: [], status }
  }
  const answer = completion.text.trim()

  // Persist evidence only for sources the answer actually cited.
  const cited = citedSubset(answer, assembled.citations)
  const byChunk = new Map(retrieval.chunks.map((c) => [c.chunkId, c]))
  const citations: AskCitation[] = cited
    .map((c) => {
      const chunk = byChunk.get(c.chunkId)
      return chunk ? toCitation(chunk, c) : null
    })
    .filter((c): c is AskCitation => c !== null)

  const messageId = await persistAssistantTurn(conversationId, answer, completion.model, citations)
  return {
    conversationId,
    messageId,
    answer,
    answered: true,
    model: completion.model,
    citations,
    status,
  }
}
