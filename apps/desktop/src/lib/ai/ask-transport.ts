import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import {
  convertToModelMessages,
  createUIMessageStream,
  streamText,
  type ChatTransport,
  type LanguageModel,
  type UIMessage,
  type UIMessageChunk,
} from 'ai'
import {
  aiKeySecretName,
  appendChatMessage,
  createChatId,
  createConversation,
  defaultAiProvider,
  getConversation,
  getModelSettings,
  keychainGet,
  retrieve,
  type AiProviderConfig,
  type RetrievedChunk,
} from '@local-brain/core'

const MAX_SOURCES = 8
const MAX_CHARS_PER_SOURCE = 1200

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
  if (!compact) return 'Ask'
  return compact.length > 60 ? `${compact.slice(0, 57)}...` : compact
}

async function ensureConversation(chatId: string, title: string): Promise<void> {
  const existing = await getConversation(chatId)
  if (!existing) await createConversation({ id: chatId, title })
}

function modelFor(config: AiProviderConfig, apiKey: string): LanguageModel {
  switch (config.provider) {
    case 'openai':
      return createOpenAI({ apiKey })(config.model)
    case 'anthropic':
      return createAnthropic({
        apiKey,
        headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
      })(config.model)
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(config.model)
  }
  const unreachable: never = config.provider
  return unreachable
}

async function resolveModel(): Promise<{ model: LanguageModel; label: string }> {
  const settings = await getModelSettings()
  const config = defaultAiProvider({
    providers: settings.providers,
    defaultProviderId: settings.defaultProviderId,
  })
  if (!config) throw new Error('No AI provider is configured. Add one in Settings.')

  const apiKey = await keychainGet(aiKeySecretName(config.id))
  if (!apiKey) throw new Error('The selected AI provider has no usable key. Add one in Settings.')

  return {
    model: modelFor(config, apiKey),
    label: `${config.provider}/${config.model}`,
  }
}

function sourceBlock(chunks: readonly RetrievedChunk[]): string {
  if (chunks.length === 0) return 'No local sources were retrieved.'
  return chunks
    .map((chunk, index) => {
      const title = chunk.recordTitle ?? chunk.recordType
      const text =
        chunk.text.length > MAX_CHARS_PER_SOURCE
          ? `${chunk.text.slice(0, MAX_CHARS_PER_SOURCE)}...`
          : chunk.text
      return `Source ${index + 1}: ${title} (${chunk.recordType}:${chunk.recordId}, chunk ${chunk.chunkIndex})\n${text}`
    })
    .join('\n\n')
}

function systemPrompt(chunks: readonly RetrievedChunk[]): string {
  return [
    'You are Local Brain, a private personal CRM and memory assistant.',
    'Answer using only the local sources below and the visible conversation.',
    'If the local sources do not support an answer, say you could not find supporting local records.',
    'Do not use outside knowledge. Be concise and direct.',
    '',
    sourceBlock(chunks),
  ].join('\n')
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
  if (!latest || latest.role !== 'user') throw new Error('Ask needs a user message to send.')
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

export function createAskTransport(): ChatTransport<UIMessage> {
  return {
    async sendMessages({ trigger, chatId, messages, abortSignal }) {
      const latestUser = messages.filter((message) => message.role === 'user').at(-1)
      const question =
        trigger === 'submit-message'
          ? await persistLatestUser(chatId, messages)
          : uiMessageText(latestUser ?? messages[messages.length - 1] ?? assistantMessage(createChatId(), ''))

      if (trigger === 'regenerate-message') {
        await ensureConversation(chatId, titleForQuestion(question))
      }

      try {
        const [{ model, label }, retrieval] = await Promise.all([
          resolveModel(),
          retrieve(question, { mode: 'hybrid', limit: MAX_SOURCES }),
        ])
        const result = streamText({
          model,
          system: systemPrompt(retrieval.chunks),
          messages: await convertToModelMessages(messages),
          maxOutputTokens: 1024,
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
