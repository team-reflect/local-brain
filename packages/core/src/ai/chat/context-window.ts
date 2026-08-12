import type { ModelMessage } from 'ai'

const CHARS_PER_TOKEN = 4
const IMAGE_TOKENS = 1_600
const MESSAGE_OVERHEAD_TOKENS = 4
const PRACTICAL_WINDOW_CEILING = 200_000
const TURN_RESERVE_TOKENS = 72_000
const ESTIMATE_HEADROOM = 0.8
const KEEP_RECENT_TOOL_RESULTS = 2
const TRUNCATED_CHAT_TEXT = '\n[Text truncated to fit the context window.]'
const DISCOVERY_TOOL_NAMES = new Set(['search_records', 'browse_records'])

/** Explicit replacement persisted in model history when a raw tool result is removed. */
export const ELIDED_CHAT_TOOL_RESULT = '[Old tool result elided to fit the context window.]'
/** Replacement sent when a detail read supersedes this turn's discovery candidates. */
export const ELIDED_CHAT_DISCOVERY_RESULT =
  '[Search candidates elided after bounded record details were loaded.]'

/** Provider capacity and system-prompt cost used to budget model history. */
export interface ChatContextWindowOptions {
  /** Advertised provider context window in tokens. */
  contextWindow: number
  /** System instructions that share the provider context window. */
  systemPrompt: string
}

type ContentPart = Exclude<ModelMessage['content'], string>[number]

function textTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function partTokens(part: ContentPart): number {
  switch (part.type) {
    case 'text':
    case 'reasoning':
      return textTokens(part.text)
    case 'image':
      return IMAGE_TOKENS
    default:
      return textTokens(JSON.stringify(part))
  }
}

/** Estimate a model message's token cost without making a provider call. */
export function estimateChatMessageTokens(message: ModelMessage): number {
  const content: string | readonly ContentPart[] = message.content
  if (typeof content === 'string') {
    return MESSAGE_OVERHEAD_TOKENS + textTokens(content)
  }
  return content.reduce((total, part) => total + partTokens(part), MESSAGE_OVERHEAD_TOKENS)
}

function totalTokens(messages: readonly ModelMessage[]): number {
  return messages.reduce((total, message) => total + estimateChatMessageTokens(message), 0)
}

function splitIntoTurns(messages: readonly ModelMessage[]): ModelMessage[][] {
  const turns: ModelMessage[][] = []
  for (const message of messages) {
    const current = turns.at(-1)
    if (message.role === 'user' || current === undefined) {
      turns.push([message])
    } else {
      current.push(message)
    }
  }
  return turns
}

function elideToolResults(message: ModelMessage): ModelMessage {
  if (message.role !== 'tool') return message
  return {
    ...message,
    content: message.content.map((part) =>
      part.type === 'tool-result'
        ? {
            ...part,
            output: { type: 'text' as const, value: ELIDED_CHAT_TOOL_RESULT },
          }
        : part,
    ),
  }
}

function isElidedToolResult(part: ContentPart): boolean {
  return part.type === 'tool-result' &&
    part.output.type === 'text' &&
    (part.output.value === ELIDED_CHAT_TOOL_RESULT ||
      part.output.value === ELIDED_CHAT_DISCOVERY_RESULT)
}

function hasToolResult(messages: readonly ModelMessage[]): boolean {
  return messages.some(
    (message) =>
      message.role === 'tool' &&
      message.content.some((part) => part.type === 'tool-result' && !isElidedToolResult(part)),
  )
}

function hasLoadedRecords(part: ContentPart): boolean {
  if (
    part.type !== 'tool-result' ||
    part.toolName !== 'get_records' ||
    part.output.type !== 'json'
  ) {
    return false
  }
  const value: unknown = part.output.value
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const records = (value as Record<string, unknown>)['records']
  return Array.isArray(records) && records.some(
    (record) =>
      typeof record === 'object' &&
      record !== null &&
      !Array.isArray(record) &&
      (record as Record<string, unknown>)['found'] === true,
  )
}

/** Keep only the newest few bulky results when one live turn itself grows too large. */
function elideOldestToolResults(
  messages: readonly ModelMessage[],
  keepNewest: number,
): ModelMessage[] {
  const kept = new Set<ContentPart>()
  let remaining = keepNewest
  for (let messageIndex = messages.length - 1; messageIndex >= 0 && remaining > 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (message?.role !== 'tool') continue
    for (let partIndex = message.content.length - 1; partIndex >= 0 && remaining > 0; partIndex -= 1) {
      const part = message.content[partIndex]
      if (part?.type === 'tool-result' && !isElidedToolResult(part)) {
        kept.add(part)
        remaining -= 1
      }
    }
  }

  return messages.map((message) => {
    if (message.role !== 'tool') return message
    return {
      ...message,
      content: message.content.map((part) =>
        part.type === 'tool-result' && !isElidedToolResult(part) && !kept.has(part)
          ? { ...part, output: { type: 'text' as const, value: ELIDED_CHAT_TOOL_RESULT } }
          : part,
      ),
    }
  })
}

/**
 * Once bounded record details are available, earlier discovery candidates have
 * served their purpose. Keep the call/result pairing for provider validity and
 * the local UI trace, but do not resend those large candidate lists to the
 * model during synthesis or later detail rounds in the same turn.
 */
function elideDiscoveryResultsBeforeRecordDetails(
  messages: readonly ModelMessage[],
): ModelMessage[] {
  let latestDetailsMessageIndex: number | null = null
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex]
    if (!message || message.role !== 'tool') continue
    for (const part of message.content) {
      if (
        part &&
        hasLoadedRecords(part) &&
        !isElidedToolResult(part)
      ) {
        latestDetailsMessageIndex = messageIndex
      }
    }
  }
  if (latestDetailsMessageIndex === null) return messages as ModelMessage[]

  let changed = false
  const compacted = messages.map((message, messageIndex) => {
    // All results in one tool message belong to the same parallel model step.
    // A same-message discovery result may be the useful fallback when the
    // parallel get_records call is empty, regardless of their part ordering.
    if (message.role !== 'tool' || messageIndex >= latestDetailsMessageIndex) {
      return message
    }
    let messageChanged = false
    const content = message.content.map((part) => {
      if (
        part.type === 'tool-result' &&
        DISCOVERY_TOOL_NAMES.has(part.toolName) &&
        !isElidedToolResult(part)
      ) {
        changed = true
        messageChanged = true
        return {
          ...part,
          output: { type: 'text' as const, value: ELIDED_CHAT_DISCOVERY_RESULT },
        }
      }
      return part
    })
    return messageChanged ? { ...message, content } as ModelMessage : message
  })
  return changed ? compacted : messages as ModelMessage[]
}

function replaceMessage(
  messages: readonly ModelMessage[],
  index: number,
  replacement: ModelMessage,
): ModelMessage[] {
  return messages.map((message, messageIndex) =>
    messageIndex === index ? replacement : message,
  )
}

function lastUserIndex(messages: readonly ModelMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return index
  }
  return -1
}

function compactEmptyMessages(messages: readonly ModelMessage[]): ModelMessage[] {
  const latestUser = lastUserIndex(messages)
  return messages.flatMap((message, messageIndex) => {
    if (typeof message.content === 'string') {
      return message.content.length > 0 || messageIndex === latestUser ? [message] : []
    }
    const content = message.content.filter(
      (part) => part.type !== 'text' || part.text.length > 0,
    )
    if (content.length > 0) {
      return [{ ...message, content } as ModelMessage]
    }
    return message.role === 'user' && messageIndex === latestUser
      ? [{ ...message, content: '' }]
      : []
  })
}

function elideNextToolResult(messages: readonly ModelMessage[]): ModelMessage[] | null {
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex]
    if (!message || typeof message.content === 'string') continue
    const partIndex = message.content.findIndex(
      (part) => part.type === 'tool-result' && !isElidedToolResult(part),
    )
    if (partIndex < 0) continue
    const content = message.content.map((part, index) =>
      index === partIndex && part.type === 'tool-result'
        ? {
            ...part,
            output: { type: 'text' as const, value: ELIDED_CHAT_TOOL_RESULT },
          }
        : part,
    )
    return replaceMessage(messages, messageIndex, { ...message, content } as ModelMessage)
  }
  return null
}

function removeLargestOptionalPart(messages: readonly ModelMessage[]): ModelMessage[] | null {
  let selected: { messageIndex: number; partIndex: number; tokens: number } | null = null
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex]
    if (!message || typeof message.content === 'string') continue
    for (let partIndex = 0; partIndex < message.content.length; partIndex += 1) {
      const part = message.content[partIndex]
      if (
        !part ||
        part.type === 'text' ||
        part.type === 'tool-call' ||
        part.type === 'tool-result'
      ) {
        continue
      }
      const tokens = partTokens(part)
      if (!selected || tokens > selected.tokens) {
        selected = { messageIndex, partIndex, tokens }
      }
    }
  }
  if (!selected) return null
  const message = messages[selected.messageIndex]
  if (!message || typeof message.content === 'string') return null
  const content = message.content.filter((_, index) => index !== selected.partIndex)
  return compactEmptyMessages(
    replaceMessage(messages, selected.messageIndex, { ...message, content } as ModelMessage),
  )
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  if (maxLength <= 0) return ''
  if (maxLength <= TRUNCATED_CHAT_TEXT.length) return text.slice(0, maxLength)
  return `${text.slice(0, maxLength - TRUNCATED_CHAT_TEXT.length)}${TRUNCATED_CHAT_TEXT}`
}

function truncateLongestText(
  messages: readonly ModelMessage[],
  budget: number,
): ModelMessage[] | null {
  let selected: {
    messageIndex: number
    partIndex: number | null
    text: string
    userPriority: number
  } | null = null
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex]
    if (!message) continue
    const userPriority = message.role === 'user' ? 1 : 0
    if (typeof message.content === 'string') {
      if (
        message.content.length > 0 &&
        (!selected ||
          userPriority < selected.userPriority ||
          (userPriority === selected.userPriority && message.content.length > selected.text.length))
      ) {
        selected = { messageIndex, partIndex: null, text: message.content, userPriority }
      }
      continue
    }
    for (let partIndex = 0; partIndex < message.content.length; partIndex += 1) {
      const part = message.content[partIndex]
      if (
        part?.type === 'text' &&
        part.text.length > 0 &&
        (!selected ||
          userPriority < selected.userPriority ||
          (userPriority === selected.userPriority && part.text.length > selected.text.length))
      ) {
        selected = { messageIndex, partIndex, text: part.text, userPriority }
      }
    }
  }
  if (!selected) return null

  const excessChars = Math.max(1, (totalTokens(messages) - budget) * CHARS_PER_TOKEN)
  const replacementText = truncateText(
    selected.text,
    Math.max(0, selected.text.length - excessChars),
  )
  const message = messages[selected.messageIndex]
  if (!message) return null
  if (selected.partIndex === null) {
    return compactEmptyMessages(
      replaceMessage(messages, selected.messageIndex, {
        ...message,
        content: replacementText,
      } as ModelMessage),
    )
  }
  if (typeof message.content === 'string') return null
  const content = message.content.map((part, index) =>
    index === selected.partIndex && part.type === 'text'
      ? { ...part, text: replacementText }
      : part,
  )
  return compactEmptyMessages(
    replaceMessage(messages, selected.messageIndex, { ...message, content } as ModelMessage),
  )
}

function pairedToolCallIds(messages: readonly ModelMessage[]): string[] {
  const calls: string[] = []
  const results = new Set<string>()
  for (const message of messages) {
    if (typeof message.content === 'string') continue
    for (const part of message.content) {
      if (part.type === 'tool-call' && !calls.includes(part.toolCallId)) {
        calls.push(part.toolCallId)
      }
      if (part.type === 'tool-result') results.add(part.toolCallId)
    }
  }
  return calls.filter((toolCallId) => results.has(toolCallId))
}

function removeToolExchange(
  messages: readonly ModelMessage[],
  toolCallId: string,
): ModelMessage[] {
  return compactEmptyMessages(
    messages.map((message) => {
      if (typeof message.content === 'string') return message
      const content = message.content.filter((part) => {
        if (part.type === 'tool-call' || part.type === 'tool-result') {
          return part.toolCallId !== toolCallId
        }
        if (part.type === 'tool-approval-request') {
          return part.toolCallId !== toolCallId
        }
        return true
      })
      return { ...message, content } as ModelMessage
    }),
  )
}

function compactTurnToBudget(
  messages: readonly ModelMessage[],
  budget: number,
): ModelMessage[] {
  if (budget <= 0) return []
  let fitted = compactEmptyMessages(messages)

  while (totalTokens(fitted) > budget) {
    const elided = elideNextToolResult(fitted)
    if (!elided) break
    fitted = elided
  }
  while (totalTokens(fitted) > budget) {
    const withoutOptionalPart = removeLargestOptionalPart(fitted)
    if (!withoutOptionalPart) break
    fitted = withoutOptionalPart
  }
  while (totalTokens(fitted) > budget) {
    const truncated = truncateLongestText(fitted, budget)
    if (!truncated) break
    fitted = truncated
  }
  while (totalTokens(fitted) > budget) {
    const [toolCallId] = pairedToolCallIds(fitted)
    if (!toolCallId) break
    fitted = removeToolExchange(fitted, toolCallId)
  }
  if (totalTokens(fitted) <= budget) return fitted

  // The structural framing itself can exceed an unusually tiny budget. Keep a
  // compact current user message when possible; otherwise an empty history is
  // safer than sending an over-budget or half-paired tool exchange.
  const latestUser = fitted[lastUserIndex(fitted)]
  return latestUser && estimateChatMessageTokens(latestUser) <= budget ? [latestUser] : []
}

/**
 * Fit model history deterministically: elide old tool payloads first, then
 * remove complete oldest user turns. If the newest turn alone is oversized,
 * elide its tool payloads, truncate text, and finally remove whole paired tool
 * exchanges as needed so a call never loses only its result.
 */
export function fitChatMessagesToContextWindow(
  messages: ModelMessage[],
  options: ChatContextWindowOptions,
): ModelMessage[] {
  const window = Math.min(options.contextWindow, PRACTICAL_WINDOW_CEILING)
  const budget = Math.max(
    0,
    Math.floor(
      (window - textTokens(options.systemPrompt) - TURN_RESERVE_TOKENS) * ESTIMATE_HEADROOM,
    ),
  )
  const turns = splitIntoTurns(messages)
  // Retrieved bodies are request-local grounding, not durable conversation
  // context. Keep their call/result shape for provider validity, but never
  // resend a prior user turn's raw tool payload on the next request.
  const priorTurnsHaveResults = turns
    .slice(0, -1)
    .some((turn) => hasToolResult(turn))
  const requestLocal = priorTurnsHaveResults
    ? turns.map((turn, index) => (index < turns.length - 1 ? turn.map(elideToolResults) : turn))
    : turns
  const requestLocalMessages = requestLocal.flat()
  const compactedCurrentTurn = elideDiscoveryResultsBeforeRecordDetails(requestLocalMessages)
  const requestWasCompacted =
    priorTurnsHaveResults || compactedCurrentTurn !== requestLocalMessages
  if (totalTokens(compactedCurrentTurn) <= budget) {
    return requestWasCompacted ? compactedCurrentTurn : messages
  }

  // A single user turn may perform several bounded reads. If their combined
  // payload still exceeds the moving budget, retain only the newest results;
  // earlier calls remain paired with an explicit elision marker.
  const elided = splitIntoTurns(
    elideOldestToolResults(compactedCurrentTurn, KEEP_RECENT_TOOL_RESULTS),
  )

  const newest = elided.at(-1)
  if (!newest) return []
  const fittedNewest = totalTokens(newest) <= budget
    ? newest
    : compactTurnToBudget(newest, budget)
  if (fittedNewest.length === 0) return []

  const kept: ModelMessage[][] = [fittedNewest]
  let used = totalTokens(fittedNewest)
  for (let index = elided.length - 2; index >= 0; index -= 1) {
    const turn = elided[index]
    if (!turn) continue
    const cost = totalTokens(turn)
    if (used + cost > budget) break
    kept.unshift(turn)
    used += cost
  }
  return kept.flat()
}
