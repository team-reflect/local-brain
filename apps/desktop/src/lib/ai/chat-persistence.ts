import type { UIMessage } from 'ai'
import {
  appendChatMessage,
  listMessages,
  replaceChatAssistantMessage,
  type ChatMessage,
  type DatabaseIdentity,
} from '@local-brain/core'

type PersistedChatStatus = 'submitted' | 'streaming' | 'done' | 'error'

/** Process-local ownership and first-write policy for one assistant response. */
export interface AssistantPersistenceTurn {
  key: string
  token: symbol
  replacementExpected: ChatMessage | null
  replacementComplete: boolean
}

const assistantPersistenceQueues = new Map<string, Promise<void>>()
const currentAssistantTurns = new Map<string, symbol>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function uiMessageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

function uiMessageJson(message: UIMessage): Record<string, unknown> {
  const cloned: unknown = JSON.parse(JSON.stringify(message))
  return isRecord(cloned) ? cloned : {}
}

function assistantPersistenceKey(
  conversationId: string,
  messageId: string,
  identity: DatabaseIdentity,
): string {
  return JSON.stringify([identity.databasePath, identity.generation, conversationId, messageId])
}

/** Supersede older callbacks for one assistant and drain any write already in flight. */
export async function beginAssistantPersistenceTurn(
  conversationId: string,
  messageId: string,
  identity: DatabaseIdentity,
  replacementExpected: ChatMessage | null,
): Promise<AssistantPersistenceTurn> {
  const key = assistantPersistenceKey(conversationId, messageId, identity)
  const token = Symbol(messageId)
  currentAssistantTurns.set(key, token)
  await assistantPersistenceQueues.get(key)?.catch(() => undefined)
  return { key, token, replacementExpected, replacementComplete: false }
}

/** Release current-turn ownership without allowing an older token to become current again. */
export function finishAssistantPersistenceTurn(turn: AssistantPersistenceTurn): void {
  if (currentAssistantTurns.get(turn.key) === turn.token) {
    currentAssistantTurns.delete(turn.key)
  }
}

function enqueueAssistantPersistence(
  turn: AssistantPersistenceTurn,
  persist: () => Promise<void>,
): Promise<void> {
  const previous = assistantPersistenceQueues.get(turn.key) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      if (currentAssistantTurns.get(turn.key) !== turn.token) return
      await persist()
    })
  assistantPersistenceQueues.set(turn.key, next)
  void next.finally(() => {
    if (assistantPersistenceQueues.get(turn.key) === next) {
      assistantPersistenceQueues.delete(turn.key)
    }
  }).catch(() => undefined)
  return next
}

function latestRegenerationTarget(
  messages: readonly ChatMessage[],
  requestedMessageId: string | undefined,
): ChatMessage {
  const target = messages.at(-1)
  const precedingUser = messages.at(-2)
  const requestedIdMatches =
    requestedMessageId === undefined ||
    target?.id === requestedMessageId ||
    (precedingUser?.role === 'user' && precedingUser.id === requestedMessageId)
  if (
    !target ||
    target.role !== 'assistant' ||
    !requestedIdMatches
  ) {
    throw new Error('Only the latest persisted user/assistant turn can be regenerated.')
  }
  return target
}

/** Resolve and revalidate the latest durable assistant under one captured brain identity. */
export async function prepareRegenerationTurn(
  conversationId: string,
  requestedMessageId: string | undefined,
  identity: DatabaseIdentity,
): Promise<{ target: ChatMessage; turn: AssistantPersistenceTurn }> {
  const initialTarget = latestRegenerationTarget(
    await listMessages(conversationId, identity),
    requestedMessageId,
  )
  const turn = await beginAssistantPersistenceTurn(
    conversationId,
    initialTarget.id,
    identity,
    initialTarget,
  )
  try {
    const target = latestRegenerationTarget(
      await listMessages(conversationId, identity),
      requestedMessageId,
    )
    if (target.id !== initialTarget.id) {
      throw new Error('The latest assistant message changed before regeneration started.')
    }
    turn.replacementExpected = target
    return { target, turn }
  } catch (error) {
    finishAssistantPersistenceTurn(turn)
    throw error
  }
}

/** Persist only the current turn, using CAS for its first regenerated snapshot. */
export async function persistAssistantForTurn(
  conversationId: string,
  message: UIMessage,
  model: string | null,
  status: PersistedChatStatus,
  error: string | null,
  identity: DatabaseIdentity,
  turn: AssistantPersistenceTurn,
): Promise<void> {
  await enqueueAssistantPersistence(turn, async () => {
    const snapshot = {
      id: message.id,
      conversationId,
      contentText: uiMessageText(message),
      uiMessageJson: uiMessageJson(message),
      model,
      status,
      error,
    }
    if (turn.replacementExpected && !turn.replacementComplete) {
      const expected = turn.replacementExpected
      const affected = await replaceChatAssistantMessage({
        ...snapshot,
        expected: {
          contentText: expected.contentText,
          uiMessageJson: expected.uiMessageJson,
          model: expected.model,
          status: expected.status,
          error: expected.error,
        },
      }, identity)
      if (affected !== 1) {
        throw {
          kind: 'stale',
          message: 'The assistant message changed before its regenerated reply could be saved.',
        }
      }
      turn.replacementComplete = true
      return
    }
    await appendChatMessage({ ...snapshot, role: 'assistant' }, identity)
  })
}
