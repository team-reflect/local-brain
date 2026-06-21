import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { createChatTransport } from './chat-transport'

const coreMocks = vi.hoisted(() => ({
  appendChatMessage: vi.fn(),
  buildChatSystemPrompt: vi.fn(),
  buildChatTools: vi.fn(),
  createChatId: vi.fn(),
  createConversation: vi.fn(),
  defaultAiProvider: vi.fn(),
  getConversation: vi.fn(),
  getModelSettings: vi.fn(),
  keychainGet: vi.fn(),
  listProjects: vi.fn(),
  localDateString: vi.fn(),
}))

const aiMocks = vi.hoisted(() => ({
  convertToModelMessages: vi.fn(),
  streamText: vi.fn(),
}))

vi.mock('@local-brain/core', () => ({
  aiKeySecretName: (id: string) => `ai-api-key:${id}`,
  appendChatMessage: coreMocks.appendChatMessage,
  buildChatSystemPrompt: coreMocks.buildChatSystemPrompt,
  buildChatTools: coreMocks.buildChatTools,
  createChatId: coreMocks.createChatId,
  createConversation: coreMocks.createConversation,
  defaultAiProvider: coreMocks.defaultAiProvider,
  getConversation: coreMocks.getConversation,
  getModelSettings: coreMocks.getModelSettings,
  keychainGet: coreMocks.keychainGet,
  listProjects: coreMocks.listProjects,
  localDateString: coreMocks.localDateString,
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
    stepCountIs: (n: number) => ({ type: 'stepCount', stepCount: n }),
  }
})

const stubTools = { search_records: {}, list_projects: {} }

const userMessage: UIMessage = {
  id: 'user-1',
  role: 'user',
  parts: [{ type: 'text', text: 'What did Maya promise?', state: 'done' }],
}

const approvalResponseMessage = {
  id: 'assistant-approval',
  role: 'assistant',
  parts: [
    {
      type: 'tool-create_task',
      toolCallId: 'tool-1',
      state: 'approval-responded',
      input: { title: 'Send budget' },
      approval: { id: 'approval-1', approved: true },
    },
  ],
} as unknown as UIMessage

describe('createChatTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    coreMocks.createChatId.mockReturnValueOnce('assistant-1')
    coreMocks.getConversation.mockResolvedValue(undefined)
    coreMocks.createConversation.mockResolvedValue('chat-1')
    coreMocks.appendChatMessage.mockResolvedValue('message-id')
    coreMocks.localDateString.mockReturnValue('2026-06-19')
    coreMocks.listProjects.mockResolvedValue([
      { id: 'p1', name: 'Atlas', status: 'active', summary: null, targetDate: null, completedOn: null, archivedAt: null, createdAt: '', updatedAt: '', kind: null, notes: null, startedOn: null },
    ])
    coreMocks.buildChatSystemPrompt.mockReturnValue('You are Local Brain. Active projects:\n- Atlas [active]')
    coreMocks.buildChatTools.mockReturnValue(stubTools)
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
    aiMocks.convertToModelMessages.mockResolvedValue([{ role: 'user', content: 'What did Maya promise?' }])
    aiMocks.streamText.mockReturnValue({
      toUIMessageStream: (options: {
        generateMessageId?: () => string
        onFinish?: (event: {
          responseMessage: UIMessage
          finishReason?: 'stop'
        }) => void | PromiseLike<void>
      }) => {
        const responseId = options.generateMessageId?.() ?? 'assistant-1'
        void options.onFinish?.({
          responseMessage: {
            id: responseId,
            role: 'assistant',
            parts: [{ type: 'text', text: 'Maya promised the revised budget.', state: 'done' }],
          },
          finishReason: 'stop',
        })
        return new ReadableStream({ start: (controller) => controller.close() })
      },
    })
  })

  it('persists the user turn, loads project context, streams with tools, and persists assistant turn', async () => {
    const transport = createChatTransport()

    await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMessage],
      abortSignal: undefined,
    })

    // Project context should have been loaded
    expect(coreMocks.listProjects).toHaveBeenCalledWith({ activeOnly: true, limit: 40 })
    expect(coreMocks.buildChatSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ today: '2026-06-19', projects: expect.any(Array) }),
    )

    // streamText should have been called with tools and the system prompt
    expect(aiMocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('Local Brain'),
        tools: stubTools,
        stopWhen: expect.anything(),
      }),
    )

    // Conversation and user message persisted
    expect(coreMocks.createConversation).toHaveBeenCalledWith({
      id: 'chat-1',
      title: 'What did Maya promise?',
    })
    expect(coreMocks.appendChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1', conversationId: 'chat-1', role: 'user' }),
    )

    // Assistant message persisted
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
    const transport = createChatTransport()

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

  it('continues after tool approval without persisting a duplicate user turn', async () => {
    const transport = createChatTransport()

    await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMessage, approvalResponseMessage],
      abortSignal: undefined,
    })

    expect(coreMocks.appendChatMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user' }),
    )
    expect(aiMocks.convertToModelMessages).toHaveBeenCalledWith([userMessage, approvalResponseMessage])
    expect(coreMocks.appendChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assistant-approval',
        conversationId: 'chat-1',
        role: 'assistant',
        contentText: 'Maya promised the revised budget.',
      }),
    )
  })
})
