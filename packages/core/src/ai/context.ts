import type { RetrievedChunk } from '../retrieval/retrieve'
import type { ModelRequest } from './provider'

/**
 * The single typed boundary through which external-model context is assembled
 * (architecture rule: "AI context assembly must go through one typed checked
 * helper"). It takes only the retrieved chunks chosen to ground an answer and
 * produces both the {@link ModelRequest} and the citation list, so:
 *
 *  - nothing but cited, retrieved text can reach the provider, and
 *  - every numbered source in the prompt maps back to a real chunk we can
 *    persist as an `evidence_refs` row.
 *
 * The model is instructed to cite with `[n]` markers that index into
 * {@link AssembledContext.citations}.
 */

export interface Citation {
  /** 1-based marker the model is told to use (`[index]`). */
  index: number
  chunkId: string
  recordType: 'document' | 'interaction'
  recordId: string
  recordTitle: string | null
}

export interface AssembledContext {
  request: ModelRequest
  citations: Citation[]
}

const SYSTEM_PROMPT = [
  'You are Local Brain, a personal knowledge assistant.',
  'Answer the question using ONLY the numbered sources provided.',
  'Cite every factual claim with bracketed source numbers like [1] or [2][3].',
  'If the sources do not contain the answer, say so plainly. Do not use outside knowledge.',
  'Be concise and direct.',
].join(' ')

export interface AssembleOptions {
  /** Trim each chunk to this many characters to bound the payload. */
  maxCharsPerChunk?: number
  maxTokens?: number
}

const DEFAULT_MAX_CHARS = 1200

export function assembleAnswerContext(
  question: string,
  chunks: readonly RetrievedChunk[],
  options: AssembleOptions = {},
): AssembledContext {
  const maxChars = options.maxCharsPerChunk ?? DEFAULT_MAX_CHARS
  const citations: Citation[] = chunks.map((chunk, i) => ({
    index: i + 1,
    chunkId: chunk.chunkId,
    recordType: chunk.recordType,
    recordId: chunk.recordId,
    recordTitle: chunk.recordTitle,
  }))

  const sources = chunks
    .map((chunk, i) => {
      const label = chunk.recordTitle ? `${chunk.recordType}: ${chunk.recordTitle}` : chunk.recordType
      const body = chunk.text.length > maxChars ? `${chunk.text.slice(0, maxChars)}…` : chunk.text
      return `[${i + 1}] (${label})\n${body}`
    })
    .join('\n\n')

  const userContent =
    chunks.length === 0
      ? `Question: ${question}\n\n(No sources were retrieved.)`
      : `Sources:\n\n${sources}\n\n---\n\nQuestion: ${question}`

  return {
    request: {
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: options.maxTokens ?? 1024,
      temperature: 0,
    },
    citations,
  }
}

/**
 * Parse the `[n]` markers the model actually used, so we only persist evidence
 * for sources the answer relied on (and never invent citations the model did
 * not make). Returns the cited subset, de-duplicated, in first-use order.
 */
export function citedSubset(answer: string, citations: readonly Citation[]): Citation[] {
  const used = new Set<number>()
  const order: number[] = []
  const regex = /\[(\d{1,3})\]/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(answer)) !== null) {
    const n = Number(match[1])
    if (!used.has(n)) {
      used.add(n)
      order.push(n)
    }
  }
  const byIndex = new Map(citations.map((c) => [c.index, c]))
  return order.map((n) => byIndex.get(n)).filter((c): c is Citation => c !== undefined)
}
