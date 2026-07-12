import {
  convertToModelMessages,
  createUIMessageStream,
  readUIMessageStream,
  stepCountIs,
  streamText,
  type ChatTransport,
  type UIMessage,
  type UIMessageChunk,
} from 'ai'
import {
  DEFAULT_CONTEXT_WINDOW,
  activeDatabaseIdentity,
  assertActiveDatabaseIdentity,
  aiProviderIdSchema,
  appendChatMessage,
  buildChatSystemPrompt,
  buildChatTools,
  createChatId,
  createConversation,
  fitChatMessagesToContextWindow,
  getConversation,
  isAppError,
  loadChatBrainOverview,
  localDateString,
  modelContextWindow,
  type DatabaseIdentity,
} from '@local-brain/core'
import { generateAndPersistConversationTitle } from './conversation-title'
import { rememberChatApprovalDatabaseIdentity } from './chat-approval'
import {
  beginAssistantPersistenceTurn,
  finishAssistantPersistenceTurn,
  persistAssistantForTurn,
  prepareRegenerationTurn,
  type AssistantPersistenceTurn,
} from './chat-persistence'
import { resolveLanguageModel, type LanguageModelSelection } from './provider'
import { errorMessage } from '../utils'

// Twelve rounds leave generous room for batched reads while bounding cost and
// latency. The last round is synthesis-only (see prepareStep below).
const TOOL_STEPS = 12
const MAX_OUTPUT_TOKENS = 8192
/** Backstop for an empty/tool-only provider completion. */
export const CHAT_NO_REPLY_FALLBACK =
  'I couldn’t finish answering from the records I gathered. Try narrowing the question or asking again.'

export interface ChatTransportOptions {
  modelSelection?: LanguageModelSelection | null
  onConversationTitleUpdated?: (conversationId: string) => void
  /** Brain path of the workspace that created this transport. */
  expectedDatabasePath?: string
}

interface TurnQuestion {
  shouldGenerateTitle: boolean
  titleUserText: string
}

interface ConversationState {
  createdConversation: boolean
  title: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function uiMessageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

function uiMessageJson(message: UIMessage): Record<string, unknown> {
  const cloned: unknown = JSON.parse(JSON.stringify(message))
  return isRecord(cloned) ? cloned : {}
}

function titleForQuestion(question: string): string {
  const compact = question.replace(/\s+/g, ' ').trim()
  if (!compact) return 'Chat'
  return compact.length > 60 ? `${compact.slice(0, 57)}...` : compact
}

async function ensureConversation(
  chatId: string,
  title: string,
  identity: DatabaseIdentity,
): Promise<ConversationState> {
  const existing = await getConversation(chatId, identity)
  if (existing) return { createdConversation: false, title: existing.title }
  await createConversation({ id: chatId, title }, identity)
  return { createdConversation: true, title }
}

function assistantMessage(messageId: string, text: string): UIMessage {
  return {
    id: messageId,
    role: 'assistant',
    parts: [{ type: 'text', text, state: 'done' }],
  }
}

function responseMessageIdForTurn(messages: readonly UIMessage[]): string {
  const latest = messages[messages.length - 1]
  return latest?.role === 'assistant' ? latest.id : createChatId()
}

function staticAssistantStream(message: UIMessage, finishReason: 'error' | 'stop'): ReadableStream<UIMessageChunk> {
  const text = uiMessageText(message)
  const textId = `${message.id}-text`
  return createUIMessageStream<UIMessage>({
    execute: ({ writer }) => {
      writer.write({ type: 'start', messageId: message.id })
      writer.write({ type: 'text-start', id: textId })
      writer.write({ type: 'text-delta', id: textId, delta: text })
      writer.write({ type: 'text-end', id: textId })
      writer.write({ type: 'finish', finishReason })
    },
  })
}

function messageHasPendingApproval(message: UIMessage): boolean {
  return message.role === 'assistant' && message.parts.some((part) => {
    const record = part as Record<string, unknown>
    const approval = record['approval']
    return (
      String(record['type'] ?? '').startsWith('tool-') &&
      record['state'] === 'approval-requested' &&
      isRecord(approval) &&
      typeof approval['id'] === 'string'
    )
  })
}

function watchPendingApprovalPersistence({
  conversationId,
  latestAssistant,
  model,
  stream,
  identity,
  turn,
}: {
  conversationId: string
  latestAssistant: UIMessage | undefined
  model: string
  stream: ReadableStream<UIMessageChunk>
  identity: DatabaseIdentity
  turn: AssistantPersistenceTurn
}): void {
  void (async () => {
    const readerOptions = {
      stream,
      onError: () => undefined,
      ...(latestAssistant ? { message: latestAssistant } : {}),
    }
    let persistedPendingApproval = false
    for await (const message of readUIMessageStream(readerOptions)) {
      if (!persistedPendingApproval && messageHasPendingApproval(message)) {
        persistedPendingApproval = true
        await persistAssistantForTurn(conversationId, message, model, 'streaming', null, identity, turn)
      }
    }
  })().catch(() => undefined)
}

async function persistLatestUser(
  conversationId: string,
  messages: readonly UIMessage[],
  identity: DatabaseIdentity,
): Promise<{ shouldGenerateTitle: boolean; titleUserText: string }> {
  const latest = messages[messages.length - 1]
  if (!latest || latest.role !== 'user') throw new Error('Chat needs a user message to send.')
  const text = uiMessageText(latest).trim()
  const titleUserText = uiMessageText(messages.find((message) => message.role === 'user') ?? latest).trim()
  const conversation = await ensureConversation(conversationId, titleForQuestion(text), identity)
  const shouldGenerateTitle =
    conversation.createdConversation || conversation.title === titleForQuestion(titleUserText)
  await appendChatMessage({
    id: latest.id,
    conversationId,
    role: 'user',
    contentText: text,
    uiMessageJson: uiMessageJson(latest),
    status: 'done',
  }, identity)
  return { shouldGenerateTitle, titleUserText }
}

async function questionForTurn(
  trigger: string,
  conversationId: string,
  messages: readonly UIMessage[],
  identity: DatabaseIdentity,
): Promise<TurnQuestion> {
  const latest = messages[messages.length - 1]
  const latestUser = messages.filter((message) => message.role === 'user').at(-1)
  if (trigger === 'submit-message' && latest?.role === 'user') {
    const { shouldGenerateTitle, titleUserText } = await persistLatestUser(
      conversationId,
      messages,
      identity,
    )
    return { shouldGenerateTitle, titleUserText }
  }
  const question = uiMessageText(latestUser ?? latest ?? assistantMessage(createChatId(), '')).trim()
  await ensureConversation(conversationId, titleForQuestion(question), identity)
  return { shouldGenerateTitle: false, titleUserText: question }
}

async function loadChatContext(): Promise<{ system: string }> {
  const today = localDateString()
  const overview = await loadChatBrainOverview().catch(() => null)
  return {
    system: buildChatSystemPrompt({ today, overview }),
  }
}

function contextWindowForModel(label: string): number {
  const separator = label.indexOf('/')
  if (separator <= 0 || separator === label.length - 1) return DEFAULT_CONTEXT_WINDOW
  const provider = aiProviderIdSchema.safeParse(label.slice(0, separator))
  return provider.success
    ? modelContextWindow(provider.data, label.slice(separator + 1))
    : DEFAULT_CONTEXT_WINDOW
}

export function createChatTransport(options: ChatTransportOptions = {}): ChatTransport<UIMessage> {
  return {
    async sendMessages({ trigger, chatId, messageId, messages, abortSignal }) {
      let identity: DatabaseIdentity | null = null
      let responseId = trigger === 'regenerate-message'
        ? null
        : responseMessageIdForTurn(messages)
      let assistantTurn: AssistantPersistenceTurn | null = null
      let responseModel: string | null = null
      try {
        const turnIdentity = await activeDatabaseIdentity()
        identity = turnIdentity
        if (
          options.expectedDatabasePath &&
          turnIdentity.databasePath !== options.expectedDatabasePath
        ) {
          throw {
            kind: 'stale',
            message: 'The active brain changed before this Chat turn could start.',
          }
        }
        const { shouldGenerateTitle, titleUserText } = await questionForTurn(
          trigger,
          chatId,
          messages,
          turnIdentity,
        )

        if (trigger === 'regenerate-message') {
          const regeneration = await prepareRegenerationTurn(chatId, messageId, turnIdentity)
          responseId = regeneration.target.id
          responseModel = regeneration.target.model
          assistantTurn = regeneration.turn
        } else {
          if (!responseId) throw new Error('Chat could not create an assistant response id.')
          assistantTurn = await beginAssistantPersistenceTurn(
            chatId,
            responseId,
            turnIdentity,
            null,
          )
        }

        const [{ model, label }, { system }] = await Promise.all([
          resolveLanguageModel(options.modelSelection),
          loadChatContext(),
        ])
        responseModel = label
        await assertActiveDatabaseIdentity(turnIdentity)
        const contextWindow = contextWindowForModel(label)
        const modelMessages = fitChatMessagesToContextWindow(
          await convertToModelMessages(messages),
          { contextWindow, systemPrompt: system },
        )
        await assertActiveDatabaseIdentity(turnIdentity)
        if (!responseId || !assistantTurn) {
          throw new Error('The assistant message to regenerate is no longer available.')
        }
        const turnResponseId = responseId
        const responseTurn = assistantTurn
        const result = streamText({
          model,
          system,
          messages: modelMessages,
          tools: buildChatTools({ databaseIdentity: turnIdentity }),
          stopWhen: stepCountIs(TOOL_STEPS),
          prepareStep: ({ stepNumber, messages: stepMessages }) => ({
            messages: fitChatMessagesToContextWindow(stepMessages, {
              contextWindow,
              systemPrompt: system,
            }),
            ...(stepNumber >= TOOL_STEPS - 1 ? { toolChoice: 'none' as const } : {}),
          }),
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          temperature: 0,
          ...(abortSignal ? { abortSignal } : {}),
        })
        const rawStream = result.toUIMessageStream<UIMessage>({
          originalMessages: messages,
          generateMessageId: () => turnResponseId,
        })
        const latest = messages[messages.length - 1]
        let responseFailed = false
        const stream = createUIMessageStream<UIMessage>({
          originalMessages: messages,
          generateId: () => turnResponseId,
          execute: async ({ writer }) => {
            let hasReplyText =
              trigger !== 'regenerate-message' &&
              latest?.role === 'assistant' &&
              uiMessageText(latest).trim().length > 0
            let awaitingApproval = false
            const reader = rawStream.getReader()
            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                if (value.type === 'text-delta' && value.delta.trim()) hasReplyText = true
                if (value.type === 'tool-approval-request') {
                  awaitingApproval = true
                  rememberChatApprovalDatabaseIdentity(value.approvalId, turnIdentity)
                }
                if (value.type === 'error' || value.type === 'abort') responseFailed = true
                if (value.type === 'finish' && !hasReplyText && !awaitingApproval && !responseFailed) {
                  const textId = `${turnResponseId}-fallback`
                  writer.write({ type: 'text-start', id: textId })
                  writer.write({ type: 'text-delta', id: textId, delta: CHAT_NO_REPLY_FALLBACK })
                  writer.write({ type: 'text-end', id: textId })
                  hasReplyText = true
                }
                writer.write(value)
              }
            } catch (error) {
              responseFailed = true
              throw error
            }
          },
          onFinish: async ({ responseMessage, finishReason, isAborted }) => {
            const status =
              finishReason === 'error'
                ? 'error'
                : messageHasPendingApproval(responseMessage)
                  ? 'streaming'
                  : 'done'
            try {
              if (
                trigger === 'regenerate-message' &&
                (isAborted || responseFailed || finishReason === 'error')
              ) return
              await persistAssistantForTurn(
                chatId,
                responseMessage,
                label,
                status,
                finishReason === 'error' ? 'The model response ended with an error.' : null,
                turnIdentity,
                responseTurn,
              )
            } finally {
              finishAssistantPersistenceTurn(responseTurn)
            }
            if (shouldGenerateTitle && finishReason !== 'error') {
              generateAndPersistConversationTitle({
                assistantText: uiMessageText(responseMessage),
                conversationId: chatId,
                model,
                onUpdated: options.onConversationTitleUpdated,
                userText: titleUserText,
                databaseIdentity: turnIdentity,
              })
            }
          },
        })
        const [uiStream, persistenceStream] = stream.tee()
        watchPendingApprovalPersistence({
          conversationId: chatId,
          latestAssistant: latest?.role === 'assistant' ? latest : undefined,
          model: label,
          stream: persistenceStream,
          identity: turnIdentity,
          turn: responseTurn,
        })
        return uiStream
      } catch (error) {
        const messageText = errorMessage(error)
        const errorTurn = assistantTurn
        const message = assistantMessage(
          responseId ?? createChatId(),
          `I couldn't answer that yet: ${messageText}`,
        )
        if (
          identity &&
          errorTurn &&
          trigger !== 'regenerate-message' &&
          (!isAppError(error) || error.kind !== 'stale')
        ) {
          const errorIdentity = identity
          await assertActiveDatabaseIdentity(errorIdentity)
            .then(() => persistAssistantForTurn(
              chatId,
              message,
              responseModel,
              'error',
              messageText,
              errorIdentity,
              errorTurn,
            ))
            .catch(() => undefined)
        }
        if (errorTurn) finishAssistantPersistenceTurn(errorTurn)
        return staticAssistantStream(message, 'error')
      }
    },
    reconnectToStream: () => Promise.resolve(null),
  }
}
