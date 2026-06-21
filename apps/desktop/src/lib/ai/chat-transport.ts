import {
  convertToModelMessages,
  createUIMessageStream,
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
import { resolveLanguageModel } from './provider'

const TOOL_STEPS = 5

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

async function ensureConversation(chatId: string, title: string): Promise<void> {
  const existing = await getConversation(chatId)
  if (!existing) await createConversation({ id: chatId, title })
}

function assistantMessage(messageId: string, text: string): UIMessage {
  return {
    id: messageId,
    role: 'assistant',
    parts: [{ type: 'text', text, state: 'done' }],
  }
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

async function persistAssistant(conversationId: string, message: UIMessage, model: string | null, error: string | null): Promise<void> {
  await appendChatMessage({
    id: message.id,
    conversationId,
    role: 'assistant',
    contentText: uiMessageText(message),
    uiMessageJson: uiMessageJson(message),
    model,
    status: error ? 'error' : 'done',
    error,
  })
}

async function persistLatestUser(conversationId: string, messages: readonly UIMessage[]): Promise<string> {
  const latest = messages[messages.length - 1]
  if (!latest || latest.role !== 'user') throw new Error('Chat needs a user message to send.')
  const text = uiMessageText(latest).trim()
  await ensureConversation(conversationId, titleForQuestion(text))
  await appendChatMessage({
    id: latest.id,
    conversationId,
    role: 'user',
    contentText: text,
    uiMessageJson: uiMessageJson(latest),
    status: 'done',
  })
  return text
}

async function questionForTurn(
  trigger: string,
  conversationId: string,
  messages: readonly UIMessage[],
): Promise<string> {
  const latest = messages[messages.length - 1]
  const latestUser = messages.filter((message) => message.role === 'user').at(-1)
  if (trigger === 'submit-message' && latest?.role === 'user') {
    return persistLatestUser(conversationId, messages)
  }
  const question = uiMessageText(latestUser ?? latest ?? assistantMessage(createChatId(), '')).trim()
  await ensureConversation(conversationId, titleForQuestion(question))
  return question
}

async function loadChatContext(): Promise<{ system: string }> {
  const today = localDateString()
  const projects = await listProjects({ activeOnly: true, limit: 40 })
  return {
    system: buildChatSystemPrompt({ today, projects }),
  }
}

export function createChatTransport(): ChatTransport<UIMessage> {
  return {
    async sendMessages({ trigger, chatId, messages, abortSignal }) {
      const question = await questionForTurn(trigger, chatId, messages)

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
        const responseId = createChatId()
        return result.toUIMessageStream<UIMessage>({
          originalMessages: messages,
          generateMessageId: () => responseId,
          onFinish: async ({ responseMessage, finishReason }) => {
            await persistAssistant(
              chatId,
              responseMessage,
              label,
              finishReason === 'error' ? 'The model response ended with an error.' : null,
            )
          },
        })
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error)
        const message = assistantMessage(createChatId(), `I couldn't answer that yet: ${messageText}`)
        await persistAssistant(chatId, message, null, messageText)
        return staticAssistantStream(message, 'error')
      }
    },
    reconnectToStream: () => Promise.resolve(null),
  }
}
