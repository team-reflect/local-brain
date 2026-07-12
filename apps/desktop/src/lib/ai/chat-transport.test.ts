import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readUIMessageStream, type ModelMessage, type UIMessage, type UIMessageChunk } from 'ai'
import { CHAT_NO_REPLY_FALLBACK, createChatTransport } from './chat-transport'

const coreMocks = vi.hoisted(() => ({
  activeDatabaseIdentity: vi.fn(),
  assertActiveDatabaseIdentity: vi.fn(),
  appendChatMessage: vi.fn(),
  buildChatSystemPrompt: vi.fn(),
  buildChatTools: vi.fn(),
  createChatId: vi.fn(),
  createConversation: vi.fn(),
  defaultAiProvider: vi.fn(),
  fitChatMessagesToContextWindow: vi.fn(),
  getConversation: vi.fn(),
  getModelSettings: vi.fn(),
  keychainGet: vi.fn(),
  loadChatBrainOverview: vi.fn(),
  localDateString: vi.fn(),
  modelContextWindow: vi.fn(),
  updateConversationTitle: vi.fn(),
}))

const aiMocks = vi.hoisted(() => ({
  convertToModelMessages: vi.fn(),
  generateText: vi.fn(),
  streamText: vi.fn(),
}))

vi.mock('@local-brain/core', () => ({
  DEFAULT_CONTEXT_WINDOW: 128_000,
  activeDatabaseIdentity: coreMocks.activeDatabaseIdentity,
  assertActiveDatabaseIdentity: coreMocks.assertActiveDatabaseIdentity,
  aiProviderIdSchema: {
    safeParse: (value: string) =>
      ['openai', 'anthropic', 'google'].includes(value)
        ? { success: true, data: value }
        : { success: false },
  },
  aiKeySecretName: (id: string) => `ai-api-key:${id}`,
  appendChatMessage: coreMocks.appendChatMessage,
  buildChatSystemPrompt: coreMocks.buildChatSystemPrompt,
  buildChatTools: coreMocks.buildChatTools,
  createChatId: coreMocks.createChatId,
  createConversation: coreMocks.createConversation,
  defaultAiProvider: coreMocks.defaultAiProvider,
  fitChatMessagesToContextWindow: coreMocks.fitChatMessagesToContextWindow,
  getConversation: coreMocks.getConversation,
  getModelSettings: coreMocks.getModelSettings,
  isAppError: (value: unknown) =>
    typeof value === 'object' && value !== null && 'kind' in value && 'message' in value,
  keychainGet: coreMocks.keychainGet,
  loadChatBrainOverview: coreMocks.loadChatBrainOverview,
  localDateString: coreMocks.localDateString,
  modelContextWindow: coreMocks.modelContextWindow,
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

const stubTools = {
  search_records: {},
  browse_records: {},
  get_records: {},
  list_tasks: {},
  list_projects: {},
}

const databaseIdentity = {
  databasePath: '/test/brain.sqlite',
  generation: 1,
} as const

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

function rawMessageStream(chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

async function lastMessageFrom(stream: ReadableStream<UIMessageChunk>): Promise<UIMessage | undefined> {
  let latest: UIMessage | undefined
  for await (const message of readUIMessageStream({ stream })) latest = message
  return latest
}

function uiMessageTextForTest(message: UIMessage | undefined): string {
  return message?.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('') ?? ''
}

describe('createChatTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    coreMocks.activeDatabaseIdentity.mockResolvedValue(databaseIdentity)
    coreMocks.assertActiveDatabaseIdentity.mockResolvedValue(undefined)
    coreMocks.createChatId.mockReturnValueOnce('assistant-1')
    coreMocks.getConversation.mockResolvedValue(undefined)
    coreMocks.createConversation.mockResolvedValue('chat-1')
    coreMocks.appendChatMessage.mockResolvedValue('message-id')
    coreMocks.localDateString.mockReturnValue('2026-06-19')
    coreMocks.loadChatBrainOverview.mockResolvedValue({
      recordCounts: { project: 1 },
      earliestRecordDate: '2026-01-01',
      latestRecordDate: '2026-06-19',
      interactionKinds: [],
      interactionKindsTruncated: false,
      tags: [],
      tagsTruncated: false,
      self: null,
      activeProjects: [{ id: 'p1', name: 'Atlas' }],
    })
    coreMocks.buildChatSystemPrompt.mockReturnValue('You are Local Brain. Active projects:\n- Atlas [active]')
    coreMocks.buildChatTools.mockReturnValue(stubTools)
    coreMocks.fitChatMessagesToContextWindow.mockImplementation((messages: ModelMessage[]) => messages)
    coreMocks.modelContextWindow.mockReturnValue(1_000_000)
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
      }) => {
        const responseId = options.generateMessageId?.() ?? 'assistant-1'
        return rawMessageStream([
          { type: 'start', messageId: responseId },
          { type: 'text-start', id: `${responseId}-text` },
          { type: 'text-delta', id: `${responseId}-text`, delta: 'Maya promised the revised budget.' },
          { type: 'text-end', id: `${responseId}-text` },
          { type: 'finish', finishReason: 'stop' },
        ])
      },
    })
  })

  afterEach(async () => {
    await settleBackgroundWork()
  })

  it('persists the turn, loads brain context, bounds history, and streams with tools', async () => {
    const transport = createChatTransport()

    await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMessage],
      abortSignal: undefined,
    })

    expect(coreMocks.loadChatBrainOverview).toHaveBeenCalledTimes(1)
    expect(coreMocks.buildChatSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ today: '2026-06-19', overview: expect.any(Object) }),
    )

    // streamText should have been called with tools and the system prompt
    expect(aiMocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('Local Brain'),
        tools: stubTools,
        stopWhen: { type: 'stepCount', stepCount: 12 },
        prepareStep: expect.any(Function),
        maxOutputTokens: 8192,
      }),
    )
    expect(coreMocks.modelContextWindow).toHaveBeenCalledWith('openai', 'gpt-5.5')
    expect(coreMocks.fitChatMessagesToContextWindow).toHaveBeenCalledWith(
      [{ role: 'user', content: 'What did Maya promise?' }],
      expect.objectContaining({ contextWindow: 1_000_000 }),
    )

    // Conversation and user message persisted
    expect(coreMocks.createConversation).toHaveBeenCalledWith(
      {
        id: 'chat-1',
        title: 'What did Maya promise?',
      },
      databaseIdentity,
    )
    expect(coreMocks.appendChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1', conversationId: 'chat-1', role: 'user' }),
      databaseIdentity,
    )

    // Assistant message persisted
    await eventually(() => {
      expect(coreMocks.appendChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'assistant-1',
          conversationId: 'chat-1',
          role: 'assistant',
          contentText: 'Maya promised the revised budget.',
          model: 'openai/gpt-5.5',
        }),
        databaseIdentity,
      )
      expect(aiMocks.generateText).toHaveBeenCalledTimes(1)
      expect(coreMocks.updateConversationTitle).toHaveBeenCalledWith(
        'chat-1',
        'Maya Budget',
        databaseIdentity,
      )
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

  it('degrades cleanly when the brain overview cannot be loaded', async () => {
    coreMocks.loadChatBrainOverview.mockRejectedValueOnce(new Error('overview unavailable'))
    const transport = createChatTransport()

    await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMessage],
      abortSignal: undefined,
    })

    expect(coreMocks.buildChatSystemPrompt).toHaveBeenCalledWith({
      today: '2026-06-19',
      overview: null,
    })
    expect(aiMocks.streamText).toHaveBeenCalledTimes(1)
  })

  it('does not start a provider request or persist into another brain after a context-load switch', async () => {
    const staleError = Object.assign(new Error('The active brain changed.'), { kind: 'stale' })
    coreMocks.assertActiveDatabaseIdentity.mockRejectedValueOnce(staleError)
    const transport = createChatTransport()

    const stream = await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMessage],
      abortSignal: undefined,
    })
    const response = await lastMessageFrom(stream)

    expect(uiMessageTextForTest(response)).toContain('The active brain changed.')
    expect(aiMocks.streamText).not.toHaveBeenCalled()
    expect(coreMocks.buildChatTools).not.toHaveBeenCalled()
    expect(coreMocks.assertActiveDatabaseIdentity).toHaveBeenCalledWith({
      databasePath: '/test/brain.sqlite',
      generation: 1,
    })
    expect(coreMocks.appendChatMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ role: 'user' }),
      { databasePath: '/test/brain.sqlite', generation: 1 },
    )
    expect(coreMocks.appendChatMessage).toHaveBeenCalledTimes(1)
  })

  it('forces the final permitted step to synthesize without another tool call', async () => {
    const transport = createChatTransport()

    await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMessage],
      abortSignal: undefined,
    })

    const [{ prepareStep }] = aiMocks.streamText.mock.calls[0] as [{
      prepareStep: (input: { stepNumber: number; messages: ModelMessage[] }) => {
        toolChoice?: 'none'
        messages: ModelMessage[]
      }
    }]
    const stepMessages: ModelMessage[] = [{ role: 'user', content: 'question' }]
    expect(prepareStep({ stepNumber: 10, messages: stepMessages })).not.toHaveProperty('toolChoice')
    expect(prepareStep({ stepNumber: 11, messages: stepMessages })).toMatchObject({
      toolChoice: 'none',
      messages: stepMessages,
    })
  })

  it('streams and persists a fallback when a turn finishes with tool activity but no reply', async () => {
    aiMocks.streamText.mockReturnValueOnce({
      toUIMessageStream: (options: { generateMessageId?: () => string }) => {
        const responseId = options.generateMessageId?.() ?? 'assistant-1'
        return rawMessageStream([
          { type: 'start', messageId: responseId },
          {
            type: 'tool-input-available',
            toolCallId: 'tool-search',
            toolName: 'search_records',
            input: { query: 'budget' },
          },
          {
            type: 'tool-output-available',
            toolCallId: 'tool-search',
            output: { records: [], count: 0 },
          },
          { type: 'finish', finishReason: 'stop' },
        ])
      },
    })
    const transport = createChatTransport()

    const stream = await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMessage],
      abortSignal: undefined,
    })
    const response = await lastMessageFrom(stream)

    expect(uiMessageTextForTest(response)).toBe(CHAT_NO_REPLY_FALLBACK)
    await eventually(() => {
      expect(coreMocks.appendChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'assistant',
          contentText: CHAT_NO_REPLY_FALLBACK,
          status: 'done',
        }),
        databaseIdentity,
      )
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
        databaseIdentity,
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
      expect(coreMocks.updateConversationTitle).toHaveBeenCalledWith(
        'chat-1',
        'Maya Budget',
        databaseIdentity,
      )
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
      databaseIdentity,
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
      toUIMessageStream: () => rawMessageStream([
        { type: 'start', messageId: 'assistant-pending-approval' },
        {
          type: 'tool-input-available',
          toolCallId: 'tool-1',
          toolName: 'create_task',
          input: { title: 'Send budget' },
        },
        {
          type: 'tool-approval-request',
          approvalId: 'approval-1',
          toolCallId: 'tool-1',
        },
        { type: 'finish', finishReason: 'stop' },
      ]),
    })
    const transport = createChatTransport()

    await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMessage],
      abortSignal: undefined,
    })

    await eventually(() => {
      expect(coreMocks.appendChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'assistant-pending-approval',
          conversationId: 'chat-1',
          role: 'assistant',
          status: 'streaming',
        }),
        databaseIdentity,
      )
      const persistedApproval = coreMocks.appendChatMessage.mock.calls.find(
        ([message]) => message.id === 'assistant-pending-approval',
      )?.[0]
      expect(JSON.stringify(persistedApproval?.uiMessageJson)).not.toContain('databaseIdentity')
      expect(JSON.stringify(persistedApproval?.uiMessageJson)).not.toContain('/test/brain.sqlite')
      expect(coreMocks.updateConversationTitle).toHaveBeenCalledWith(
        'chat-1',
        'Maya Budget',
        databaseIdentity,
      )
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
      expect.anything(),
    )
    expect(aiMocks.convertToModelMessages).toHaveBeenCalledWith([userMessage, approvalResponseMessage])
    await eventually(() => {
      expect(coreMocks.appendChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'assistant-approval',
          conversationId: 'chat-1',
          role: 'assistant',
          contentText: 'Maya promised the revised budget.',
        }),
        databaseIdentity,
      )
    })
    await settleBackgroundWork()
    expect(aiMocks.generateText).not.toHaveBeenCalled()
  })
})
