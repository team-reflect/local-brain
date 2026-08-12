import type { UIMessage } from 'ai'
import { isChatWriteToolName, type ChatRecordDetailBudget } from '@local-brain/core'

const READ_ONLY_TOOL_STEPS = 4
const WRITE_TOOL_STEPS = 12
const FACTUAL_RECORD_DETAIL_BUDGET: ChatRecordDetailBudget = {
  maxCalls: 1,
  maxRecords: 6,
  maxTotalChars: 24_000,
}
const WRITE_ACTION =
  '(?:add|assign|change|complete|correct|create|edit|finish|log|make|mark|move|note|record|remember|rename|reschedule|save|schedule|set|store|track|update)'
const FACTUAL_WRITE_VERB_PHRASE = [
  /^(?:please\s+)?update\s+(?:me|us)\s+(?:on|about)\b/iu,
  /^(?:can|could|would|will)\s+you\s+(?:please\s+)?update\s+(?:me|us)\s+(?:on|about)\b/iu,
  /^(?:please\s+)?remember\s+(?:if|how|what|when|where|whether|who|why)\b/iu,
  /^(?:can|could|do|would|will)\s+you\s+(?:please\s+)?remember\s+(?:if|how|what|when|where|whether|who|why)\b/iu,
]

function hasWriteTool(message: UIMessage): boolean {
  return message.parts.some((part) => {
    const type = String((part as Record<string, unknown>)['type'] ?? '')
    return type.startsWith('tool-') && isChatWriteToolName(type.slice('tool-'.length))
  })
}

function requestsWrite(message: UIMessage | undefined): boolean {
  if (!message || message.role !== 'user') return false
  const text = message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  const intentText = FACTUAL_WRITE_VERB_PHRASE.reduce(
    (remaining, pattern) => remaining.replace(pattern, ''),
    text,
  ).replace(/^[\s,;:.-]+/u, '')
  return (
    new RegExp(`^(?:please\\s+)?${WRITE_ACTION}\\b`, 'i').test(intentText) ||
    new RegExp(`(?:[.!?;,]|\\b(?:and|then))\\s+(?:please\\s+)?${WRITE_ACTION}\\b`, 'i').test(intentText) ||
    new RegExp(`\\b(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?${WRITE_ACTION}\\b`, 'i').test(intentText) ||
    new RegExp(`\\b(?:i(?:'d| would) like|i want|i need)\\s+(?:you\\s+to\\s+)?${WRITE_ACTION}\\b`, 'i').test(intentText) ||
    /^remind me\b/i.test(intentText)
  )
}

export interface ChatTurnPolicy {
  /** Maximum provider steps in the current turn, including final synthesis. */
  toolStepLimit: number
  /** Optional stricter record-detail limits applied to factual/read-first turns. */
  recordDetailBudget?: ChatRecordDetailBudget
}

/** Return provider-step and record-loading limits for the current Chat turn. */
export function chatTurnPolicy(messages: readonly UIMessage[]): ChatTurnPolicy {
  let latestUserIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      latestUserIndex = index
      break
    }
  }
  const latestUser = latestUserIndex >= 0 ? messages[latestUserIndex] : undefined
  const currentTurnMessages = latestUserIndex >= 0
    ? messages.slice(latestUserIndex + 1)
    : messages
  if (currentTurnMessages.some(hasWriteTool)) {
    return { toolStepLimit: WRITE_TOOL_STEPS }
  }
  if (requestsWrite(latestUser)) {
    return {
      toolStepLimit: WRITE_TOOL_STEPS,
      recordDetailBudget: FACTUAL_RECORD_DETAIL_BUDGET,
    }
  }
  return {
    toolStepLimit: READ_ONLY_TOOL_STEPS,
    recordDetailBudget: FACTUAL_RECORD_DETAIL_BUDGET,
  }
}
