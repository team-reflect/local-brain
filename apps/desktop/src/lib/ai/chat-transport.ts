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
  appendChatMessage,
  buildChatSystemPrompt,
  buildChatTools,
  createChatId,
  createConversation,
  getConversation,
  listProjects,
  localDateString,
} from '@local-brain/core'
import { generateAndPersistConversationTitle } from './conversation-title'
import { resolveLanguageModel } from './provider'

const TOOL_STEPS = 5
type PersistedChatStatus = 'submitted' | 'streaming' | 'done' | 'error'

export interface ChatTransportOptions {
  onConversationTitleUpdated?: (conversationId: string) => void
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

async function ensureConversation(chatId: string, title: string): Promise<ConversationState> {
  const existing = await getConversation(chatId)
  if (existing) return { createdConversation: false, title: existing.title }
  await createConversation({ id: chatId, title })
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
  })
}

function watchPendingApprovalPersistence({
  conversationId,
  latestAssistant,
  model,
  stream,
}: {
  conversationId: string
  latestAssistant: UIMessage | undefined
  model: string
  stream: ReadableStream<UIMessageChunk>
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
        await persistAssistant(conversationId, message, model, 'streaming', null)
      }
    }
  })()
}

async function persistLatestUser(
  conversationId: string,
  messages: readonly UIMessage[],
): Promise<{ shouldGenerateTitle: boolean; text: string; titleUserText: string }> {
  const latest = messages[messages.length - 1]
  if (!latest || latest.role !== 'user') throw new Error('Chat needs a user message to send.')
  const text = uiMessageText(latest).trim()
  const titleUserText = uiMessageText(messages.find((message) => message.role === 'user') ?? latest).trim()
  const conversation = await ensureConversation(conversationId, titleForQuestion(text))
  const shouldGenerateTitle =
    conversation.createdConversation || conversation.title === titleForQuestion(titleUserText)
  await appendChatMessage({
    id: latest.id,
    conversationId,
    role: 'user',
    contentText: text,
    uiMessageJson: uiMessageJson(latest),
    status: 'done',
  })
  return { shouldGenerateTitle, text, titleUserText }
}

async function questionForTurn(
  trigger: string,
  conversationId: string,
  messages: readonly UIMessage[],
): Promise<TurnQuestion> {
  const latest = messages[messages.length - 1]
  const latestUser = messages.filter((message) => message.role === 'user').at(-1)
  if (trigger === 'submit-message' && latest?.role === 'user') {
    const { shouldGenerateTitle, text, titleUserText } = await persistLatestUser(conversationId, messages)
    return { question: text, shouldGenerateTitle, titleUserText }
  }
  const question = uiMessageText(latestUser ?? latest ?? assistantMessage(createChatId(), '')).trim()
  await ensureConversation(conversationId, titleForQuestion(question))
  return { question, shouldGenerateTitle: false, titleUserText: question }
}

async function loadChatContext(): Promise<{ system: string }> {
  const today = localDateString()
  const projects = await listProjects({ activeOnly: true, limit: 40 })
  return {
    system: buildChatSystemPrompt({ today, projects }),
  }
}

export function createChatTransport(options: ChatTransportOptions = {}): ChatTransport<UIMessage> {
  return {
    async sendMessages({ trigger, chatId, messages, abortSignal }) {
      const { question, shouldGenerateTitle, titleUserText } = await questionForTurn(trigger, chatId, messages)

      if (trigger === 'regenerate-message') {
        await ensureConversation(chatId, titleForQuestion(question))
      }

      try {
        const [{ model, label }, { system }] = await Promise.all([
          resolveLanguageModel(),
          loadChatContext(),
        ])
        const result = streamText({
          model,
          system,
          messages: await convertToModelMessages(messages),
          tools: buildChatTools(),
          stopWhen: stepCountIs(TOOL_STEPS),
          maxOutputTokens: 2048,
          temperature: 0,
          ...(abortSignal ? { abortSignal } : {}),
        })
        const responseId = responseMessageIdForTurn(messages)
        const stream = result.toUIMessageStream<UIMessage>({
          originalMessages: messages,
          generateMessageId: () => responseId,
          onFinish: async ({ responseMessage, finishReason }) => {
            const status = finishReason === 'error' ? 'error' :
              messageHasPendingApproval(responseMessage) ? 'streaming' : 'done'
            await persistAssistant(
              chatId,
              responseMessage,
              label,
              status,
              finishReason === 'error' ? 'The model response ended with an error.' : null,
            )
            if (shouldGenerateTitle && finishReason !== 'error') {
              generateAndPersistConversationTitle({
                assistantText: uiMessageText(responseMessage),
                conversationId: chatId,
                model,
                onUpdated: options.onConversationTitleUpdated,
                userText: titleUserText,
              })
            }
          },
        })
        const [uiStream, persistenceStream] = stream.tee()
        const latest = messages[messages.length - 1]
        watchPendingApprovalPersistence({
          conversationId: chatId,
          latestAssistant: latest?.role === 'assistant' ? latest : undefined,
          model: label,
          stream: persistenceStream,
        })
        return uiStream
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error)
        const message = assistantMessage(createChatId(), `I couldn't answer that yet: ${messageText}`)
        await persistAssistant(chatId, message, null, 'error', messageText)
        return staticAssistantStream(message, 'error')
      }
    },
    reconnectToStream: () => Promise.resolve(null),
  }
}
