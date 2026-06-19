import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { createAskTransport } from './ask-transport'

const coreMocks = vi.hoisted(() => ({
  appendChatMessage: vi.fn(),
  createChatId: vi.fn(),
  createConversation: vi.fn(),
  defaultAiProvider: vi.fn(),
  getConversation: vi.fn(),
  getModelSettings: vi.fn(),
  keychainGet: vi.fn(),
  retrieve: vi.fn(),
}))

const aiMocks = vi.hoisted(() => ({
  convertToModelMessages: vi.fn(),
  streamText: vi.fn(),
}))

vi.mock('@local-brain/core', () => ({
  aiKeySecretName: (id: string) => `ai-api-key:${id}`,
  appendChatMessage: coreMocks.appendChatMessage,
  createChatId: coreMocks.createChatId,
  createConversation: coreMocks.createConversation,
  defaultAiProvider: coreMocks.defaultAiProvider,
  getConversation: coreMocks.getConversation,
  getModelSettings: coreMocks.getModelSettings,
  keychainGet: coreMocks.keychainGet,
  retrieve: coreMocks.retrieve,
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: () => (model: string) => ({ provider: 'openai', model }),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: () => (model: string) => ({ provider: 'anthropic', model }),
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: () => (model: string) => ({ provider: 'google', model }),
}))

vi.mock('ai', async (importActual) => {
  const actual = await importActual<typeof import('ai')>()
  return {
    ...actual,
    convertToModelMessages: aiMocks.convertToModelMessages,
    streamText: aiMocks.streamText,
  }
})

const userMessage: UIMessage = {
  id: 'user-1',
  role: 'user',
  parts: [{ type: 'text', text: 'What did Maya promise?', state: 'done' }],
}

describe('createAskTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    coreMocks.createChatId.mockReturnValueOnce('assistant-1')
    coreMocks.getConversation.mockResolvedValue(undefined)
    coreMocks.createConversation.mockResolvedValue('chat-1')
    coreMocks.appendChatMessage.mockResolvedValue('message-id')
    coreMocks.getModelSettings.mockResolvedValue({
      providers: [{ id: 'provider-1', provider: 'openai', model: 'gpt-5.5', keyHint: '12345' }],
      defaultProviderId: 'provider-1',
      provider: 'openai',
      model: 'gpt-5.5',
    })
    coreMocks.defaultAiProvider.mockReturnValue({
      id: 'provider-1',
      provider: 'openai',
      model: 'gpt-5.5',
      keyHint: '12345',
    })
    coreMocks.keychainGet.mockResolvedValue('sk-test')
    coreMocks.retrieve.mockResolvedValue({
      query: 'What did Maya promise?',
      mode: 'hybrid',
      semanticAvailable: false,
      chunks: [
        {
          chunkId: 'chunk-1',
          text: 'Maya promised to send the revised budget.',
          snippet: 'Maya promised...',
          recordType: 'interaction',
          recordId: 'interaction-1',
          recordTitle: 'Call with Maya',
          chunkIndex: 0,
          score: 1,
          lexicalScore: 1,
        },
      ],
    })
    aiMocks.convertToModelMessages.mockResolvedValue([{ role: 'user', content: 'What did Maya promise?' }])
    aiMocks.streamText.mockReturnValue({
      toUIMessageStream: (options: {
        onFinish?: (event: {
          responseMessage: UIMessage
          finishReason?: 'stop'
        }) => void | PromiseLike<void>
      }) => {
        void options.onFinish?.({
          responseMessage: {
            id: 'assistant-1',
            role: 'assistant',
            parts: [{ type: 'text', text: 'Maya promised the revised budget.', state: 'done' }],
          },
          finishReason: 'stop',
        })
        return new ReadableStream({ start: (controller) => controller.close() })
      },
    })
  })

  it('persists the user turn, retrieves grounding chunks, streams, and persists the assistant turn', async () => {
    const transport = createAskTransport()

    await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMessage],
      abortSignal: undefined,
    })

    expect(coreMocks.createConversation).toHaveBeenCalledWith({
      id: 'chat-1',
      title: 'What did Maya promise?',
    })
    expect(coreMocks.retrieve).toHaveBeenCalledWith('What did Maya promise?', { mode: 'hybrid', limit: 8 })
    expect(aiMocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('Call with Maya'),
      }),
    )
    expect(coreMocks.appendChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1', conversationId: 'chat-1', role: 'user' }),
    )
    expect(coreMocks.appendChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assistant-1',
        conversationId: 'chat-1',
        role: 'assistant',
        contentText: 'Maya promised the revised budget.',
        model: 'openai/gpt-5.5',
      }),
    )
  })

  it('persists an assistant error turn when no provider is configured', async () => {
    coreMocks.defaultAiProvider.mockReturnValue(null)
    const transport = createAskTransport()

    await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMessage],
      abortSignal: undefined,
    })

    expect(coreMocks.appendChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'chat-1',
        role: 'assistant',
        status: 'error',
        error: expect.stringContaining('No AI provider'),
      }),
    )
  })
})
