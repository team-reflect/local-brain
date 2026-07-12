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
import { resolveLanguageModel, type LanguageModelSelection } from './provider'
import { errorMessage } from '../utils'

// Twelve rounds leave generous room for batched reads while bounding cost and
// latency. The last round is synthesis-only (see prepareStep below).
const TOOL_STEPS = 12
const MAX_OUTPUT_TOKENS = 8192
/** Backstop for an empty/tool-only provider completion. */
export const CHAT_NO_REPLY_FALLBACK =
  'I couldn’t finish answering from the records I gathered. Try narrowing the question or asking again.'
type PersistedChatStatus = 'submitted' | 'streaming' | 'done' | 'error'

export interface ChatTransportOptions {
  modelSelection?: LanguageModelSelection | null
  onConversationTitleUpdated?: (conversationId: string) => void
  /** Brain path of the workspace that created this transport. */
  expectedDatabasePath?: string
}

interface TurnQuestion {
  question: string
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

async function persistAssistant(
  conversationId: string,
  message: UIMessage,
  model: string | null,
  status: PersistedChatStatus,
  error: string | null,
  identity: DatabaseIdentity,
): Promise<void> {
  await appendChatMessage({
    id: message.id,
    conversationId,
    role: 'assistant',
    contentText: uiMessageText(message),
    uiMessageJson: uiMessageJson(message),
    model,
    status,
    error,
  }, identity)
}

function watchPendingApprovalPersistence({
  conversationId,
  latestAssistant,
  model,
  stream,
  identity,
}: {
  conversationId: string
  latestAssistant: UIMessage | undefined
  model: string
  stream: ReadableStream<UIMessageChunk>
  identity: DatabaseIdentity
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
        await persistAssistant(conversationId, message, model, 'streaming', null, identity)
      }
    }
  })().catch(() => undefined)
}

async function persistLatestUser(
  conversationId: string,
  messages: readonly UIMessage[],
  identity: DatabaseIdentity,
): Promise<{ shouldGenerateTitle: boolean; text: string; titleUserText: string }> {
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
  return { shouldGenerateTitle, text, titleUserText }
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
    const { shouldGenerateTitle, text, titleUserText } = await persistLatestUser(
      conversationId,
      messages,
      identity,
    )
    return { question: text, shouldGenerateTitle, titleUserText }
  }
  const question = uiMessageText(latestUser ?? latest ?? assistantMessage(createChatId(), '')).trim()
  await ensureConversation(conversationId, titleForQuestion(question), identity)
  return { question, shouldGenerateTitle: false, titleUserText: question }
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
    async sendMessages({ trigger, chatId, messages, abortSignal }) {
      let identity: DatabaseIdentity | null = null
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
        const { question, shouldGenerateTitle, titleUserText } = await questionForTurn(
          trigger,
          chatId,
          messages,
          turnIdentity,
        )

        if (trigger === 'regenerate-message') {
          await ensureConversation(chatId, titleForQuestion(question), turnIdentity)
        }

        const [{ model, label }, { system }] = await Promise.all([
          resolveLanguageModel(options.modelSelection),
          loadChatContext(),
        ])
        await assertActiveDatabaseIdentity(turnIdentity)
        const contextWindow = contextWindowForModel(label)
        const modelMessages = fitChatMessagesToContextWindow(
          await convertToModelMessages(messages),
          { contextWindow, systemPrompt: system },
        )
        await assertActiveDatabaseIdentity(turnIdentity)
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
        const responseId = responseMessageIdForTurn(messages)
        const rawStream = result.toUIMessageStream<UIMessage>({
          originalMessages: messages,
          generateMessageId: () => responseId,
        })
        const latest = messages[messages.length - 1]
        const stream = createUIMessageStream<UIMessage>({
          originalMessages: messages,
          generateId: () => responseId,
          execute: async ({ writer }) => {
            let hasReplyText =
              latest?.role === 'assistant' && uiMessageText(latest).trim().length > 0
            let awaitingApproval = false
            let failed = false
            const reader = rawStream.getReader()
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              if (value.type === 'text-delta' && value.delta.trim()) hasReplyText = true
              if (value.type === 'tool-approval-request') {
                awaitingApproval = true
                rememberChatApprovalDatabaseIdentity(value.approvalId, turnIdentity)
              }
              if (value.type === 'error' || value.type === 'abort') failed = true
              if (value.type === 'finish' && !hasReplyText && !awaitingApproval && !failed) {
                const textId = `${responseId}-fallback`
                writer.write({ type: 'text-start', id: textId })
                writer.write({ type: 'text-delta', id: textId, delta: CHAT_NO_REPLY_FALLBACK })
                writer.write({ type: 'text-end', id: textId })
                hasReplyText = true
              }
              writer.write(value)
            }
          },
          onFinish: async ({ responseMessage, finishReason }) => {
            const status =
              finishReason === 'error'
                ? 'error'
                : messageHasPendingApproval(responseMessage)
                  ? 'streaming'
                  : 'done'
            await persistAssistant(
              chatId,
              responseMessage,
              label,
              status,
              finishReason === 'error' ? 'The model response ended with an error.' : null,
              turnIdentity,
            )
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
        })
        return uiStream
      } catch (error) {
        const messageText = errorMessage(error)
        const message = assistantMessage(createChatId(), `I couldn't answer that yet: ${messageText}`)
        if (identity && (!isAppError(error) || error.kind !== 'stale')) {
          const errorIdentity = identity
          await assertActiveDatabaseIdentity(errorIdentity)
            .then(() => persistAssistant(chatId, message, null, 'error', messageText, errorIdentity))
            .catch(() => undefined)
        }
        return staticAssistantStream(message, 'error')
      }
    },
    reconnectToStream: () => Promise.resolve(null),
  }
}
