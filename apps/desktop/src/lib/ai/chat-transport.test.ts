import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  updateConversationTitle: vi.fn(),
}))

const aiMocks = vi.hoisted(() => ({
  convertToModelMessages: vi.fn(),
  generateText: vi.fn(),
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
  updateConversationTitle: coreMocks.updateConversationTitle,
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
    generateText: aiMocks.generateText,
    streamText: aiMocks.streamText,
    stepCountIs: (n: number) => ({ type: 'stepCount', stepCount: n }),
  }
})

const stubTools = { search_records: {}, get_records: {}, list_projects: {} }

const userMessage: UIMessage = {
  id: 'user-1',
  role: 'user',
  parts: [{ type: 'text', text: 'What did Maya promise?', state: 'done' }],
}

const retryUserMessage: UIMessage = {
  id: 'user-2',
  role: 'user',
  parts: [{ type: 'text', text: 'Try again now', state: 'done' }],
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

const pendingApprovalMessage = {
  id: 'assistant-pending-approval',
  role: 'assistant',
  parts: [
    {
      type: 'tool-create_task',
      toolCallId: 'tool-1',
      state: 'approval-requested',
      input: { title: 'Send budget' },
      approval: { id: 'approval-1' },
    },
  ],
} as unknown as UIMessage

async function settleBackgroundWork(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

async function eventually(assertion: () => void): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  if (lastError instanceof Error) throw lastError
  assertion()
}

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
    coreMocks.updateConversationTitle.mockResolvedValue(1)
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
    aiMocks.generateText.mockResolvedValue({ output: { title: '"Maya Budget!"' } })
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

  afterEach(async () => {
    await settleBackgroundWork()
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
    await eventually(() => {
      expect(aiMocks.generateText).toHaveBeenCalledTimes(1)
      expect(coreMocks.updateConversationTitle).toHaveBeenCalledWith('chat-1', 'Maya Budget')
    })
  })

  it('notifies callers after saving a generated title', async () => {
    const onConversationTitleUpdated = vi.fn()
    const transport = createChatTransport({ onConversationTitleUpdated })

    await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMessage],
      abortSignal: undefined,
    })

    await eventually(() => {
      expect(onConversationTitleUpdated).toHaveBeenCalledWith('chat-1')
    })
  })

  it('uses a chat-selected model instead of the settings default', async () => {
    const transport = createChatTransport({
      modelSelection: { configId: 'provider-1', modelId: 'gpt-5.4-mini' },
    })

    await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMessage],
      abortSignal: undefined,
    })

    expect(aiMocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { provider: 'openai', model: 'gpt-5.4-mini' },
      }),
    )
    await eventually(() =>
      expect(coreMocks.appendChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'chat-1',
          role: 'assistant',
          model: 'openai/gpt-5.4-mini',
        }),
      ),
    )
  })

  it('skips generated titles for existing conversations', async () => {
    coreMocks.getConversation.mockResolvedValue({
      id: 'chat-1',
      title: 'Existing',
      createdAt: '2026-06-19T00:00:00.000Z',
      updatedAt: '2026-06-19T00:00:00.000Z',
      archivedAt: null,
    })
    const transport = createChatTransport()

    await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMessage],
      abortSignal: undefined,
    })
    await settleBackgroundWork()

    expect(coreMocks.createConversation).not.toHaveBeenCalled()
    expect(aiMocks.generateText).not.toHaveBeenCalled()
    expect(coreMocks.updateConversationTitle).not.toHaveBeenCalled()
  })

  it('generates a title for an existing conversation still using the first-prompt fallback', async () => {
    coreMocks.getConversation.mockResolvedValue({
      id: 'chat-1',
      title: 'What did Maya promise?',
      createdAt: '2026-06-19T00:00:00.000Z',
      updatedAt: '2026-06-19T00:00:00.000Z',
      archivedAt: null,
    })
    const transport = createChatTransport()

    await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMessage, retryUserMessage],
      abortSignal: undefined,
    })

    await eventually(() => {
      expect(aiMocks.generateText).toHaveBeenCalledTimes(1)
      expect(coreMocks.updateConversationTitle).toHaveBeenCalledWith('chat-1', 'Maya Budget')
    })
    const [{ prompt }] = aiMocks.generateText.mock.calls[0] as [{ prompt: string }]
    expect(prompt).toContain('What did Maya promise?')
    expect(prompt).not.toContain('Try again now')
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
    await settleBackgroundWork()
    expect(aiMocks.generateText).not.toHaveBeenCalled()
    expect(coreMocks.updateConversationTitle).not.toHaveBeenCalled()
  })

  it('swallows generated title failures', async () => {
    aiMocks.generateText.mockRejectedValueOnce(new Error('title failed'))
    const onConversationTitleUpdated = vi.fn()
    const transport = createChatTransport({ onConversationTitleUpdated })

    await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMessage],
      abortSignal: undefined,
    })
    await eventually(() => {
      expect(aiMocks.generateText).toHaveBeenCalledTimes(1)
    })
    await settleBackgroundWork()

    expect(coreMocks.updateConversationTitle).not.toHaveBeenCalled()
    expect(onConversationTitleUpdated).not.toHaveBeenCalled()
  })

  it('keeps approval-paused assistant turns streaming when the model stream finishes', async () => {
    aiMocks.streamText.mockReturnValueOnce({
      toUIMessageStream: (options: {
        generateMessageId?: () => string
        onFinish?: (event: {
          responseMessage: UIMessage
          finishReason?: 'stop'
        }) => void | PromiseLike<void>
      }) => {
        void options.generateMessageId?.()
        void options.onFinish?.({
          responseMessage: pendingApprovalMessage,
          finishReason: 'stop',
        })
        return new ReadableStream({ start: (controller) => controller.close() })
      },
    })
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
        id: 'assistant-pending-approval',
        conversationId: 'chat-1',
        role: 'assistant',
        status: 'streaming',
      }),
    )
    await eventually(() => {
      expect(coreMocks.updateConversationTitle).toHaveBeenCalledWith('chat-1', 'Maya Budget')
    })
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
    await settleBackgroundWork()
    expect(aiMocks.generateText).not.toHaveBeenCalled()
  })
})
