import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { readUIMessageStream, type ModelMessage, type UIMessage, type UIMessageChunk } from 'ai'
import type { ChatMessage } from '@local-brain/core'
import { CHAT_NO_REPLY_FALLBACK, createChatTransport } from './chat-transport'
import { handleChatToolApprovalResponse } from './chat-approval'
import {
  beginAssistantPersistenceTurn,
  finishAssistantPersistenceTurn,
  persistAssistantForTurn,
  rollbackRegeneratedAssistantForTurn,
} from './chat-persistence'

const coreMocks = vi.hoisted(() => ({
  activeDatabaseIdentity: vi.fn(),
  assertActiveDatabaseIdentity: vi.fn(),
  appendChatMessage: vi.fn(),
  buildChatSystemPrompt: vi.fn(),
  buildChatTools: vi.fn(),
  createChatId: vi.fn(),
  createConversation: vi.fn(),
  defaultAiProvider: vi.fn(),
  executeChatWriteTool: vi.fn(),
  fitChatMessagesToContextWindow: vi.fn(),
  getConversation: vi.fn(),
  getModelSettings: vi.fn(),
  isChatWriteToolName: vi.fn(),
  keychainGet: vi.fn(),
  listMessages: vi.fn(),
  loadChatBrainOverview: vi.fn(),
  localDateString: vi.fn(),
  modelContextWindow: vi.fn(),
  replaceChatAssistantMessage: vi.fn(),
  updateChatMessageSnapshot: vi.fn(),
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
  executeChatWriteTool: coreMocks.executeChatWriteTool,
  fitChatMessagesToContextWindow: coreMocks.fitChatMessagesToContextWindow,
  getConversation: coreMocks.getConversation,
  getModelSettings: coreMocks.getModelSettings,
  isAppError: (value: unknown) =>
    typeof value === 'object' && value !== null && 'kind' in value && 'message' in value,
  isChatWriteToolName: coreMocks.isChatWriteToolName,
  keychainGet: coreMocks.keychainGet,
  listMessages: coreMocks.listMessages,
  loadChatBrainOverview: coreMocks.loadChatBrainOverview,
  localDateString: coreMocks.localDateString,
  modelContextWindow: coreMocks.modelContextWindow,
  replaceChatAssistantMessage: coreMocks.replaceChatAssistantMessage,
  updateChatMessageSnapshot: coreMocks.updateChatMessageSnapshot,
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

function controlledRawMessageStream(): {
  stream: ReadableStream<UIMessageChunk>
  write: (chunk: UIMessageChunk) => void
  close: () => void
  fail: (error: Error) => void
} {
  let controller: ReadableStreamDefaultController<UIMessageChunk> | null = null
  const stream = new ReadableStream<UIMessageChunk>({
    start(nextController) {
      controller = nextController
    },
  })
  return {
    stream,
    write: (chunk) => {
      if (!controller) throw new Error('Expected the controlled stream to be ready.')
      controller.enqueue(chunk)
    },
    close: () => {
      if (!controller) throw new Error('Expected the controlled stream to be ready.')
      controller.close()
    },
    fail: (error) => {
      if (!controller) throw new Error('Expected the controlled stream to be ready.')
      controller.error(error)
    },
  }
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

function persistedMessage(
  message: UIMessage,
  status: 'done' | 'error' | 'streaming' = 'done',
): ChatMessage {
  return {
    id: message.id,
    conversationId: 'chat-1',
    role: message.role,
    contentText: uiMessageTextForTest(message),
    uiMessageJson: JSON.parse(JSON.stringify(message)) as Record<string, unknown>,
    model: message.role === 'assistant' ? 'openai/gpt-5.5' : null,
    status,
    error: null,
    createdAt: '2026-06-19T00:00:00.000Z',
  }
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
    coreMocks.executeChatWriteTool.mockResolvedValue({ kind: 'task', action: 'created', id: 'task-1' })
    coreMocks.isChatWriteToolName.mockImplementation((toolName: string) => toolName === 'create_task')
    coreMocks.listMessages.mockResolvedValue([])
    coreMocks.replaceChatAssistantMessage.mockResolvedValue(1)
    coreMocks.updateChatMessageSnapshot.mockResolvedValue(1)
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
    expect(coreMocks.listMessages).not.toHaveBeenCalled()
    expect(coreMocks.replaceChatAssistantMessage).not.toHaveBeenCalled()

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

  it('streams and persists a fallback when a regenerated reply only has tool activity', async () => {
    const priorAssistant: UIMessage = {
      id: 'assistant-prior',
      role: 'assistant',
      parts: [{ type: 'text', text: 'The prior answer.', state: 'done' }],
    }
    coreMocks.listMessages.mockResolvedValue([
      persistedMessage(userMessage),
      persistedMessage(priorAssistant),
    ])
    aiMocks.streamText.mockReturnValueOnce({
      toUIMessageStream: (options: { generateMessageId?: () => string }) => {
        const responseId = options.generateMessageId?.() ?? priorAssistant.id
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
      trigger: 'regenerate-message',
      chatId: 'chat-1',
      messageId: priorAssistant.id,
      // AI SDK removes the assistant being regenerated before it calls the
      // transport and carries that row's identity separately in `messageId`.
      messages: [userMessage],
      abortSignal: undefined,
    })
    const response = await lastMessageFrom(stream)

    expect(response?.id).toBe(priorAssistant.id)
    expect(uiMessageTextForTest(response)).toBe(CHAT_NO_REPLY_FALLBACK)
    expect(aiMocks.convertToModelMessages).toHaveBeenCalledWith([userMessage])
    expect(coreMocks.listMessages).toHaveBeenCalledWith('chat-1', databaseIdentity)
    await eventually(() => {
      expect(coreMocks.replaceChatAssistantMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: priorAssistant.id,
          contentText: CHAT_NO_REPLY_FALLBACK,
          status: 'done',
        }),
        databaseIdentity,
      )
    })
  })

  it('keeps the prior terminal snapshot until a complete regenerated reply is available', async () => {
    const priorAssistant: UIMessage = {
      id: 'assistant-prior',
      role: 'assistant',
      parts: [{ type: 'text', text: 'The prior answer.', state: 'done' }],
    }
    coreMocks.listMessages.mockResolvedValue([
      persistedMessage(userMessage),
      persistedMessage(priorAssistant),
    ])
    const controlled = controlledRawMessageStream()
    aiMocks.streamText.mockReturnValueOnce({
      toUIMessageStream: () => controlled.stream,
    })
    const transport = createChatTransport()

    const stream = await transport.sendMessages({
      trigger: 'regenerate-message',
      chatId: 'chat-1',
      messageId: priorAssistant.id,
      messages: [userMessage],
      abortSignal: undefined,
    })

    expect(coreMocks.replaceChatAssistantMessage).not.toHaveBeenCalled()
    expect(coreMocks.appendChatMessage).not.toHaveBeenCalled()

    controlled.write({ type: 'start', messageId: priorAssistant.id })
    controlled.write({ type: 'text-start', id: 'regenerated-text' })
    controlled.write({ type: 'text-delta', id: 'regenerated-text', delta: 'A new answer.' })
    controlled.write({ type: 'text-end', id: 'regenerated-text' })
    controlled.write({ type: 'finish', finishReason: 'stop' })
    controlled.close()
    await lastMessageFrom(stream)

    await eventually(() => {
      expect(coreMocks.replaceChatAssistantMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: priorAssistant.id,
          contentText: 'A new answer.',
          status: 'done',
          expected: expect.objectContaining({
            contentText: 'The prior answer.',
            status: 'done',
          }),
        }),
        databaseIdentity,
      )
    })
  })

  it('rejects older regeneration identifiers without reusing a persisted record id', async () => {
    const olderAssistant: UIMessage = {
      id: 'assistant-older',
      role: 'assistant',
      parts: [{ type: 'text', text: 'An older answer.', state: 'done' }],
    }
    const latestAssistant: UIMessage = {
      id: 'assistant-latest',
      role: 'assistant',
      parts: [{ type: 'text', text: 'The latest answer.', state: 'done' }],
    }
    coreMocks.listMessages.mockResolvedValue([
      persistedMessage(userMessage),
      persistedMessage(olderAssistant),
      persistedMessage(retryUserMessage),
      persistedMessage(latestAssistant),
    ])
    const transport = createChatTransport()

    const stream = await transport.sendMessages({
      trigger: 'regenerate-message',
      chatId: 'chat-1',
      messageId: olderAssistant.id,
      messages: [userMessage],
      abortSignal: undefined,
    })
    const response = await lastMessageFrom(stream)

    expect(response?.id).toBe('assistant-1')
    expect(response?.id).not.toBe(olderAssistant.id)
    expect(response?.id).not.toBe(userMessage.id)
    expect(uiMessageTextForTest(response)).toContain('Only the latest persisted user/assistant turn')
    expect(aiMocks.streamText).not.toHaveBeenCalled()
    expect(coreMocks.replaceChatAssistantMessage).not.toHaveBeenCalled()
    expect(coreMocks.appendChatMessage).not.toHaveBeenCalled()
  })

  it('maps the latest user regeneration id to its following persisted assistant id', async () => {
    const priorAssistant: UIMessage = {
      id: 'assistant-prior',
      role: 'assistant',
      parts: [{ type: 'text', text: 'The prior answer.', state: 'done' }],
    }
    coreMocks.listMessages.mockResolvedValue([
      persistedMessage(userMessage),
      persistedMessage(priorAssistant),
    ])
    const transport = createChatTransport()

    const stream = await transport.sendMessages({
      trigger: 'regenerate-message',
      chatId: 'chat-1',
      messageId: userMessage.id,
      // AI SDK retains a targeted user message but removes its following
      // assistant before invoking the transport.
      messages: [userMessage],
      abortSignal: undefined,
    })
    const response = await lastMessageFrom(stream)

    expect(response?.id).toBe(priorAssistant.id)
    expect(response?.id).not.toBe(userMessage.id)
    expect(aiMocks.convertToModelMessages).toHaveBeenCalledWith([userMessage])
    await eventually(() => {
      expect(coreMocks.replaceChatAssistantMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: priorAssistant.id, status: 'done' }),
        databaseIdentity,
      )
    })
  })

  it('resolves a no-id regeneration to the latest persisted assistant in the captured brain', async () => {
    const olderAssistant: UIMessage = {
      id: 'assistant-older',
      role: 'assistant',
      parts: [{ type: 'text', text: 'An older answer.', state: 'done' }],
    }
    const priorAssistant: UIMessage = {
      id: 'assistant-latest',
      role: 'assistant',
      parts: [{ type: 'text', text: 'The prior answer.', state: 'done' }],
    }
    coreMocks.listMessages.mockResolvedValue([
      persistedMessage(userMessage),
      persistedMessage(olderAssistant),
      persistedMessage(priorAssistant),
    ])
    const transport = createChatTransport()

    const stream = await transport.sendMessages({
      trigger: 'regenerate-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMessage],
      abortSignal: undefined,
    })
    const response = await lastMessageFrom(stream)

    expect(response?.id).toBe(priorAssistant.id)
    expect(coreMocks.listMessages).toHaveBeenCalledWith('chat-1', databaseIdentity)
    expect(coreMocks.createChatId).not.toHaveBeenCalled()
    await eventually(() => {
      expect(coreMocks.replaceChatAssistantMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: priorAssistant.id, status: 'done' }),
        databaseIdentity,
      )
    })
  })

  it('persists a regenerated pending approval without clearing the terminal assistant first', async () => {
    const priorAssistant: UIMessage = {
      id: 'assistant-prior',
      role: 'assistant',
      parts: [{ type: 'text', text: 'The prior answer.', state: 'done' }],
    }
    coreMocks.listMessages.mockResolvedValue([
      persistedMessage(userMessage),
      persistedMessage(priorAssistant),
    ])
    aiMocks.streamText.mockReturnValueOnce({
      toUIMessageStream: (options: { generateMessageId?: () => string }) => {
        const responseId = options.generateMessageId?.() ?? priorAssistant.id
        return rawMessageStream([
          { type: 'start', messageId: responseId },
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
        ])
      },
    })
    const transport = createChatTransport()

    const stream = await transport.sendMessages({
      trigger: 'regenerate-message',
      chatId: 'chat-1',
      messageId: priorAssistant.id,
      messages: [userMessage],
      abortSignal: undefined,
    })
    const response = await lastMessageFrom(stream)

    expect(response?.id).toBe(priorAssistant.id)
    await eventually(() => {
      expect(coreMocks.replaceChatAssistantMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: priorAssistant.id,
          conversationId: 'chat-1',
          status: 'streaming',
        }),
        databaseIdentity,
      )
    })
    await settleBackgroundWork()
    expect(coreMocks.replaceChatAssistantMessage).toHaveBeenCalledTimes(1)
  })

  it('treats a regenerated approval CAS loss to a fast user action as benign and sticky', async () => {
    const priorAssistant: UIMessage = {
      id: 'assistant-prior',
      role: 'assistant',
      parts: [{ type: 'text', text: 'The prior answer.', state: 'done' }],
    }
    const pendingApproval = {
      id: priorAssistant.id,
      role: 'assistant',
      parts: [
        {
          type: 'tool-create_task',
          toolCallId: 'tool-1',
          state: 'approval-requested',
          approval: { id: 'approval-1' },
          input: { title: 'Send budget' },
        },
      ],
    } as unknown as UIMessage
    const controlled = controlledRawMessageStream()
    coreMocks.listMessages.mockResolvedValue([
      persistedMessage(userMessage),
      persistedMessage(priorAssistant),
    ])
    coreMocks.replaceChatAssistantMessage
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
    aiMocks.streamText.mockReturnValueOnce({ toUIMessageStream: () => controlled.stream })
    const stream = await createChatTransport().sendMessages({
      trigger: 'regenerate-message',
      chatId: 'chat-1',
      messageId: priorAssistant.id,
      messages: [userMessage],
      abortSignal: undefined,
    })

    controlled.write({ type: 'start', messageId: priorAssistant.id })
    controlled.write({
      type: 'tool-input-available',
      toolCallId: 'tool-1',
      toolName: 'create_task',
      input: { title: 'Send budget' },
    })
    controlled.write({
      type: 'tool-approval-request',
      approvalId: 'approval-1',
      toolCallId: 'tool-1',
    })
    await eventually(() => {
      expect(coreMocks.replaceChatAssistantMessage).toHaveBeenCalledTimes(1)
    })

    let currentMessages = [pendingApproval]
    await handleChatToolApprovalResponse(
      { id: 'approval-1', approved: true },
      {
        chatId: 'chat-1',
        getMessages: () => currentMessages,
        queryClient: new QueryClient(),
        setMessages: (messages) => {
          currentMessages = messages
        },
        addToolApprovalResponse: vi.fn(),
        expectedDatabasePath: databaseIdentity.databasePath,
      },
    )
    controlled.write({ type: 'text-start', id: 'late-text' })
    controlled.write({ type: 'text-delta', id: 'late-text', delta: 'Additional context.' })
    controlled.write({ type: 'text-end', id: 'late-text' })
    controlled.write({ type: 'finish', finishReason: 'stop' })
    controlled.close()

    const response = await lastMessageFrom(stream)
    expect(uiMessageTextForTest(response)).toBe('Additional context.')
    await eventually(() => {
      expect(coreMocks.replaceChatAssistantMessage).toHaveBeenCalledTimes(2)
    })
    expect(coreMocks.replaceChatAssistantMessage).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        contentText: 'Additional context.',
        expected: expect.objectContaining({ contentText: '', status: 'streaming' }),
      }),
      databaseIdentity,
    )
    expect(coreMocks.replaceChatAssistantMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ contentText: 'The prior answer.' }),
      databaseIdentity,
    )
    expect(coreMocks.executeChatWriteTool).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      name: 'aborts before an approval is accepted',
      tail: [{ type: 'abort', reason: 'stopped' }] as UIMessageChunk[],
      approvalResponse: true,
      abortBeforeProvider: true,
    },
    {
      name: 'aborts before an approval is denied',
      tail: [{ type: 'abort', reason: 'stopped' }] as UIMessageChunk[],
      approvalResponse: false,
      abortBeforeProvider: false,
    },
    {
      name: 'emits an error',
      tail: [
        { type: 'error', errorText: 'provider stream failed' },
        { type: 'finish', finishReason: 'stop' },
      ] as UIMessageChunk[],
      approvalResponse: undefined,
      abortBeforeProvider: false,
    },
  ])('restores the exact prior assistant when regeneration $name after persisting an approval', async ({
    abortBeforeProvider,
    approvalResponse,
    tail,
  }) => {
    const priorAssistant: UIMessage = {
      id: 'assistant-prior',
      role: 'assistant',
      parts: [{ type: 'text', text: 'The prior answer.', state: 'done' }],
    }
    const priorSnapshot = persistedMessage(priorAssistant)
    const controlled = controlledRawMessageStream()
    coreMocks.listMessages.mockResolvedValue([
      persistedMessage(userMessage),
      priorSnapshot,
    ])
    aiMocks.streamText.mockReturnValueOnce({
      toUIMessageStream: () => controlled.stream,
    })
    const transport = createChatTransport()
    const abortController = new AbortController()

    const stream = await transport.sendMessages({
      trigger: 'regenerate-message',
      chatId: 'chat-1',
      messageId: priorAssistant.id,
      messages: [userMessage],
      abortSignal: abortController.signal,
    })
    controlled.write({ type: 'start', messageId: priorAssistant.id })
    controlled.write({
      type: 'tool-input-available',
      toolCallId: 'tool-1',
      toolName: 'create_task',
      input: { title: 'Send budget' },
    })
    controlled.write({
      type: 'tool-approval-request',
      approvalId: 'approval-1',
      toolCallId: 'tool-1',
    })

    await eventually(() => {
      expect(coreMocks.replaceChatAssistantMessage).toHaveBeenCalledTimes(1)
    })
    const pendingReplacement = coreMocks.replaceChatAssistantMessage.mock.calls[0]?.[0]

    if (abortBeforeProvider) {
      abortController.abort()
      await eventually(() => {
        expect(coreMocks.replaceChatAssistantMessage).toHaveBeenCalledTimes(2)
      })
    }

    for (const chunk of tail) controlled.write(chunk)
    controlled.close()
    const response = await lastMessageFrom(stream)

    await eventually(() => {
      expect(coreMocks.replaceChatAssistantMessage).toHaveBeenCalledTimes(2)
    })
    expect(coreMocks.replaceChatAssistantMessage).toHaveBeenNthCalledWith(2, {
      id: priorSnapshot.id,
      conversationId: priorSnapshot.conversationId,
      contentText: priorSnapshot.contentText,
      uiMessageJson: priorSnapshot.uiMessageJson,
      model: priorSnapshot.model,
      status: priorSnapshot.status,
      error: priorSnapshot.error,
      expected: {
        contentText: pendingReplacement.contentText,
        uiMessageJson: pendingReplacement.uiMessageJson,
        model: pendingReplacement.model,
        status: pendingReplacement.status,
        error: pendingReplacement.error,
      },
    }, databaseIdentity)
    expect(coreMocks.appendChatMessage).not.toHaveBeenCalled()

    if (approvalResponse !== undefined) {
      if (!response) throw new Error('Expected the aborted approval message to remain visible.')
      let currentMessages = [response]
      const addToolApprovalResponse = vi.fn()
      await handleChatToolApprovalResponse(
        { id: 'approval-1', approved: approvalResponse },
        {
          chatId: 'chat-1',
          getMessages: () => currentMessages,
          queryClient: new QueryClient(),
          setMessages: (nextMessages) => {
            currentMessages = nextMessages
          },
          addToolApprovalResponse,
          expectedDatabasePath: databaseIdentity.databasePath,
        },
      )

      const toolPart = currentMessages[0]?.parts.find((part) => part.type === 'tool-create_task')
      expect(toolPart).toMatchObject(approvalResponse
        ? {
            state: 'output-error',
            approval: { id: 'approval-1', approved: true },
            errorText: 'This approval is no longer valid. Retry the request.',
          }
        : {
            state: 'output-denied',
            approval: { id: 'approval-1', approved: false },
          })
      expect(coreMocks.executeChatWriteTool).not.toHaveBeenCalled()
      expect(coreMocks.updateChatMessageSnapshot).not.toHaveBeenCalled()
      expect(addToolApprovalResponse).not.toHaveBeenCalled()
      expect(coreMocks.replaceChatAssistantMessage).toHaveBeenCalledTimes(2)
    }
  })

  it('keeps a user-approved continuation when it wins before an abort signal', async () => {
    const priorAssistant: UIMessage = {
      id: 'assistant-prior',
      role: 'assistant',
      parts: [{ type: 'text', text: 'The prior answer.', state: 'done' }],
    }
    const pendingApproval = {
      id: priorAssistant.id,
      role: 'assistant',
      parts: [
        {
          type: 'tool-create_task',
          toolCallId: 'tool-1',
          state: 'approval-requested',
          approval: { id: 'approval-1' },
          input: { title: 'Send budget' },
        },
      ],
    } as unknown as UIMessage
    const controlled = controlledRawMessageStream()
    coreMocks.listMessages.mockResolvedValue([
      persistedMessage(userMessage),
      persistedMessage(priorAssistant),
    ])
    aiMocks.streamText.mockReturnValueOnce({ toUIMessageStream: () => controlled.stream })
    const abortController = new AbortController()
    const stream = await createChatTransport().sendMessages({
      trigger: 'regenerate-message',
      chatId: 'chat-1',
      messageId: priorAssistant.id,
      messages: [userMessage],
      abortSignal: abortController.signal,
    })

    controlled.write({ type: 'start', messageId: priorAssistant.id })
    controlled.write({
      type: 'tool-input-available',
      toolCallId: 'tool-1',
      toolName: 'create_task',
      input: { title: 'Send budget' },
    })
    controlled.write({
      type: 'tool-approval-request',
      approvalId: 'approval-1',
      toolCallId: 'tool-1',
    })
    await eventually(() => {
      expect(coreMocks.replaceChatAssistantMessage).toHaveBeenCalledTimes(1)
    })

    let currentMessages = [pendingApproval]
    await handleChatToolApprovalResponse(
      { id: 'approval-1', approved: true },
      {
        chatId: 'chat-1',
        getMessages: () => currentMessages,
        queryClient: new QueryClient(),
        setMessages: (messages) => {
          currentMessages = messages
        },
        addToolApprovalResponse: vi.fn(),
        expectedDatabasePath: databaseIdentity.databasePath,
      },
    )
    expect(coreMocks.executeChatWriteTool).toHaveBeenCalledTimes(1)

    abortController.abort()
    controlled.write({ type: 'abort', reason: 'stopped' })
    controlled.close()
    await lastMessageFrom(stream)
    await settleBackgroundWork()

    expect(coreMocks.replaceChatAssistantMessage).toHaveBeenCalledTimes(1)
    expect(coreMocks.updateChatMessageSnapshot).toHaveBeenCalled()
  })

  it('keeps sibling approvals actionable when one user action wins before abort', async () => {
    const priorAssistant: UIMessage = {
      id: 'assistant-prior',
      role: 'assistant',
      parts: [{ type: 'text', text: 'The prior answer.', state: 'done' }],
    }
    const pendingApprovals = {
      id: priorAssistant.id,
      role: 'assistant',
      parts: [
        {
          type: 'tool-create_task',
          toolCallId: 'tool-1',
          state: 'approval-requested',
          approval: { id: 'approval-1' },
          input: { title: 'Send budget' },
        },
        {
          type: 'tool-create_task',
          toolCallId: 'tool-2',
          state: 'approval-requested',
          approval: { id: 'approval-2' },
          input: { title: 'Book review' },
        },
      ],
    } as unknown as UIMessage
    const controlled = controlledRawMessageStream()
    coreMocks.listMessages.mockResolvedValue([
      persistedMessage(userMessage),
      persistedMessage(priorAssistant),
    ])
    aiMocks.streamText.mockReturnValueOnce({ toUIMessageStream: () => controlled.stream })
    const abortController = new AbortController()
    const stream = await createChatTransport().sendMessages({
      trigger: 'regenerate-message',
      chatId: 'chat-1',
      messageId: priorAssistant.id,
      messages: [userMessage],
      abortSignal: abortController.signal,
    })

    controlled.write({ type: 'start', messageId: priorAssistant.id })
    for (const [toolCallId, approvalId, title] of [
      ['tool-1', 'approval-1', 'Send budget'],
      ['tool-2', 'approval-2', 'Book review'],
    ] as const) {
      controlled.write({
        type: 'tool-input-available',
        toolCallId,
        toolName: 'create_task',
        input: { title },
      })
      controlled.write({ type: 'tool-approval-request', approvalId, toolCallId })
    }
    await eventually(() => {
      expect(coreMocks.replaceChatAssistantMessage).toHaveBeenCalledTimes(1)
    })

    let currentMessages = [pendingApprovals]
    const approvalOptions = {
      chatId: 'chat-1',
      getMessages: () => currentMessages,
      queryClient: new QueryClient(),
      setMessages: (messages: UIMessage[]) => {
        currentMessages = messages
      },
      addToolApprovalResponse: vi.fn(),
      expectedDatabasePath: databaseIdentity.databasePath,
    }
    await handleChatToolApprovalResponse(
      { id: 'approval-1', approved: true },
      approvalOptions,
    )

    abortController.abort()
    controlled.write({ type: 'abort', reason: 'stopped' })
    controlled.close()
    await lastMessageFrom(stream)
    await settleBackgroundWork()
    expect(coreMocks.replaceChatAssistantMessage).toHaveBeenCalledTimes(1)

    await handleChatToolApprovalResponse(
      { id: 'approval-2', approved: true },
      approvalOptions,
    )
    expect(coreMocks.executeChatWriteTool).toHaveBeenNthCalledWith(
      1,
      'create_task',
      { title: 'Send budget' },
      databaseIdentity,
    )
    expect(coreMocks.executeChatWriteTool).toHaveBeenNthCalledWith(
      2,
      'create_task',
      { title: 'Book review' },
      databaseIdentity,
    )
    expect(coreMocks.updateChatMessageSnapshot).toHaveBeenCalledTimes(4)
    expect(currentMessages[0]?.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolCallId: 'tool-2', state: 'output-available' }),
    ]))
  })

  it('keeps an aborted normal-submit approval durable and actionable', async () => {
    aiMocks.streamText.mockReturnValueOnce({
      toUIMessageStream: () => rawMessageStream([
        { type: 'start', messageId: 'assistant-1' },
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
        { type: 'abort', reason: 'stopped' },
      ]),
    })
    const stream = await createChatTransport().sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      messages: [userMessage],
      abortSignal: undefined,
    })
    const response = await lastMessageFrom(stream)
    if (!response) throw new Error('Expected the pending approval response.')

    await eventually(() => {
      expect(coreMocks.appendChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'assistant-1',
          role: 'assistant',
          status: 'streaming',
        }),
        databaseIdentity,
      )
    })

    let currentMessages = [response]
    await handleChatToolApprovalResponse(
      { id: 'approval-1', approved: true },
      {
        chatId: 'chat-1',
        getMessages: () => currentMessages,
        queryClient: new QueryClient(),
        setMessages: (messages) => {
          currentMessages = messages
        },
        addToolApprovalResponse: vi.fn(),
        expectedDatabasePath: databaseIdentity.databasePath,
      },
    )

    expect(coreMocks.executeChatWriteTool).toHaveBeenCalledTimes(1)
    expect(currentMessages[0]?.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool-create_task',
        state: 'output-available',
      }),
    ]))
  })

  it('does not roll back a regenerated approval after a newer turn takes ownership', async () => {
    const priorAssistant: UIMessage = {
      id: 'assistant-prior',
      role: 'assistant',
      parts: [{ type: 'text', text: 'The prior answer.', state: 'done' }],
    }
    const pendingApproval = {
      id: priorAssistant.id,
      role: 'assistant',
      parts: [
        {
          type: 'tool-create_task',
          toolCallId: 'tool-1',
          state: 'approval-requested',
          approval: { id: 'approval-1' },
          input: { title: 'Send budget' },
        },
      ],
    } as unknown as UIMessage
    const priorSnapshot = persistedMessage(priorAssistant)
    const oldTurn = await beginAssistantPersistenceTurn(
      'chat-1',
      priorAssistant.id,
      databaseIdentity,
      priorSnapshot,
    )
    await persistAssistantForTurn(
      'chat-1',
      pendingApproval,
      'openai/gpt-5.5',
      'streaming',
      null,
      databaseIdentity,
      oldTurn,
    )
    const newerTurn = await beginAssistantPersistenceTurn(
      'chat-1',
      priorAssistant.id,
      databaseIdentity,
      null,
    )

    try {
      await rollbackRegeneratedAssistantForTurn('chat-1', databaseIdentity, oldTurn)
      expect(coreMocks.replaceChatAssistantMessage).toHaveBeenCalledTimes(1)
    } finally {
      finishAssistantPersistenceTurn(oldTurn)
      finishAssistantPersistenceTurn(newerTurn)
    }
  })

  it('CAS-advances regenerated snapshots and rolls back from the latest owned state', async () => {
    const priorAssistant: UIMessage = {
      id: 'assistant-prior',
      role: 'assistant',
      parts: [{ type: 'text', text: 'The prior answer.', state: 'done' }],
    }
    const firstApproval = {
      id: priorAssistant.id,
      role: 'assistant',
      parts: [
        {
          type: 'tool-create_task',
          toolCallId: 'tool-1',
          state: 'approval-requested',
          approval: { id: 'approval-1' },
          input: { title: 'Send budget' },
        },
      ],
    } as unknown as UIMessage
    const updatedApproval = {
      ...firstApproval,
      parts: [
        { type: 'text', text: 'This needs your approval.', state: 'done' },
        ...firstApproval.parts,
      ],
    } as UIMessage
    const priorSnapshot = persistedMessage(priorAssistant)
    const turn = await beginAssistantPersistenceTurn(
      'chat-1',
      priorAssistant.id,
      databaseIdentity,
      priorSnapshot,
    )

    try {
      await persistAssistantForTurn(
        'chat-1',
        firstApproval,
        'openai/gpt-5.5',
        'streaming',
        null,
        databaseIdentity,
        turn,
      )
      await persistAssistantForTurn(
        'chat-1',
        updatedApproval,
        'openai/gpt-5.5',
        'streaming',
        null,
        databaseIdentity,
        turn,
      )
      await rollbackRegeneratedAssistantForTurn('chat-1', databaseIdentity, turn)

      expect(coreMocks.replaceChatAssistantMessage).toHaveBeenNthCalledWith(2,
        expect.objectContaining({
          contentText: 'This needs your approval.',
          expected: {
            contentText: '',
            uiMessageJson: JSON.parse(JSON.stringify(firstApproval)),
            model: 'openai/gpt-5.5',
            status: 'streaming',
            error: null,
          },
        }),
        databaseIdentity,
      )
      expect(coreMocks.replaceChatAssistantMessage).toHaveBeenNthCalledWith(3, {
        id: priorSnapshot.id,
        conversationId: priorSnapshot.conversationId,
        contentText: priorSnapshot.contentText,
        uiMessageJson: priorSnapshot.uiMessageJson,
        model: priorSnapshot.model,
        status: priorSnapshot.status,
        error: priorSnapshot.error,
        expected: {
          contentText: 'This needs your approval.',
          uiMessageJson: JSON.parse(JSON.stringify(updatedApproval)),
          model: 'openai/gpt-5.5',
          status: 'streaming',
          error: null,
        },
      }, databaseIdentity)
    } finally {
      finishAssistantPersistenceTurn(turn)
    }
  })

  it('keeps the prior durable assistant when regeneration fails before streaming', async () => {
    const priorAssistant: UIMessage = {
      id: 'assistant-prior',
      role: 'assistant',
      parts: [{ type: 'text', text: 'The prior answer.', state: 'done' }],
    }
    coreMocks.listMessages.mockResolvedValue([
      persistedMessage(userMessage),
      persistedMessage(priorAssistant),
    ])
    coreMocks.defaultAiProvider.mockReturnValueOnce(null)
    const transport = createChatTransport()

    const stream = await transport.sendMessages({
      trigger: 'regenerate-message',
      chatId: 'chat-1',
      messageId: priorAssistant.id,
      messages: [userMessage],
      abortSignal: undefined,
    })
    const response = await lastMessageFrom(stream)

    expect(response?.id).toBe(priorAssistant.id)
    expect(uiMessageTextForTest(response)).toContain('No AI provider')
    expect(coreMocks.appendChatMessage).not.toHaveBeenCalled()
    expect(coreMocks.replaceChatAssistantMessage).not.toHaveBeenCalled()
    expect(coreMocks.createChatId).not.toHaveBeenCalled()
    expect(aiMocks.streamText).not.toHaveBeenCalled()
  })

  it('leaves the prior assistant snapshot intact when regeneration becomes stale', async () => {
    const priorAssistant: UIMessage = {
      id: 'assistant-prior',
      role: 'assistant',
      parts: [{ type: 'text', text: 'The prior answer.', state: 'done' }],
    }
    const staleError = Object.assign(new Error('The active brain changed.'), { kind: 'stale' })
    coreMocks.listMessages.mockResolvedValue([
      persistedMessage(userMessage),
      persistedMessage(priorAssistant),
    ])
    coreMocks.assertActiveDatabaseIdentity.mockRejectedValueOnce(staleError)
    const transport = createChatTransport()

    const stream = await transport.sendMessages({
      trigger: 'regenerate-message',
      chatId: 'chat-1',
      messageId: priorAssistant.id,
      messages: [userMessage],
      abortSignal: undefined,
    })
    const response = await lastMessageFrom(stream)

    expect(response?.id).toBe(priorAssistant.id)
    expect(uiMessageTextForTest(response)).toContain('The active brain changed.')
    expect(coreMocks.replaceChatAssistantMessage).not.toHaveBeenCalled()
    expect(coreMocks.appendChatMessage).not.toHaveBeenCalled()
    expect(aiMocks.streamText).not.toHaveBeenCalled()
  })

  it('keeps the prior durable assistant when regeneration is aborted with partial text', async () => {
    const priorAssistant: UIMessage = {
      id: 'assistant-prior',
      role: 'assistant',
      parts: [{ type: 'text', text: 'The prior answer.', state: 'done' }],
    }
    coreMocks.listMessages.mockResolvedValue([
      persistedMessage(userMessage),
      persistedMessage(priorAssistant),
    ])
    aiMocks.streamText.mockReturnValueOnce({
      toUIMessageStream: () => rawMessageStream([
        { type: 'start', messageId: priorAssistant.id },
        { type: 'text-start', id: 'partial-text' },
        { type: 'text-delta', id: 'partial-text', delta: 'A partial replacement.' },
        { type: 'text-end', id: 'partial-text' },
        { type: 'abort', reason: 'stopped' },
      ]),
    })
    const transport = createChatTransport()

    const stream = await transport.sendMessages({
      trigger: 'regenerate-message',
      chatId: 'chat-1',
      messageId: priorAssistant.id,
      messages: [userMessage],
      abortSignal: undefined,
    })
    await lastMessageFrom(stream)
    await settleBackgroundWork()

    expect(coreMocks.replaceChatAssistantMessage).not.toHaveBeenCalled()
    expect(coreMocks.appendChatMessage).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'closes without a finish chunk', tail: [] as UIMessageChunk[] },
    {
      name: 'is followed by a successful-looking finish chunk',
      tail: [{ type: 'finish', finishReason: 'stop' }] as UIMessageChunk[],
    },
  ])('keeps the prior durable assistant when an error-only regeneration $name', async ({ tail }) => {
    const priorAssistant: UIMessage = {
      id: 'assistant-prior',
      role: 'assistant',
      parts: [{ type: 'text', text: 'The prior answer.', state: 'done' }],
    }
    coreMocks.listMessages.mockResolvedValue([
      persistedMessage(userMessage),
      persistedMessage(priorAssistant),
    ])
    aiMocks.streamText.mockReturnValueOnce({
      toUIMessageStream: () => rawMessageStream([
        { type: 'start', messageId: priorAssistant.id },
        { type: 'text-start', id: 'partial-text' },
        { type: 'text-delta', id: 'partial-text', delta: 'A partial replacement.' },
        { type: 'text-end', id: 'partial-text' },
        { type: 'error', errorText: 'provider stream failed' },
        ...tail,
      ]),
    })
    const transport = createChatTransport()

    const stream = await transport.sendMessages({
      trigger: 'regenerate-message',
      chatId: 'chat-1',
      messageId: priorAssistant.id,
      messages: [userMessage],
      abortSignal: undefined,
    })
    const reader = stream.getReader()
    while (!(await reader.read()).done) {
      // Drain the UI stream so its onFinish persistence policy runs.
    }
    await settleBackgroundWork()

    expect(coreMocks.replaceChatAssistantMessage).not.toHaveBeenCalled()
    expect(coreMocks.appendChatMessage).not.toHaveBeenCalled()
  })

  it('restores the prior durable assistant when the raw stream rejects after an approval', async () => {
    const priorAssistant: UIMessage = {
      id: 'assistant-prior',
      role: 'assistant',
      parts: [{ type: 'text', text: 'The prior answer.', state: 'done' }],
    }
    const controlled = controlledRawMessageStream()
    coreMocks.listMessages.mockResolvedValue([
      persistedMessage(userMessage),
      persistedMessage(priorAssistant),
    ])
    aiMocks.streamText.mockReturnValueOnce({
      toUIMessageStream: () => controlled.stream,
    })
    const transport = createChatTransport()

    const stream = await transport.sendMessages({
      trigger: 'regenerate-message',
      chatId: 'chat-1',
      messageId: priorAssistant.id,
      messages: [userMessage],
      abortSignal: undefined,
    })
    const reader = stream.getReader()
    controlled.write({ type: 'start', messageId: priorAssistant.id })
    controlled.write({
      type: 'tool-input-available',
      toolCallId: 'tool-1',
      toolName: 'create_task',
      input: { title: 'Send budget' },
    })
    controlled.write({
      type: 'tool-approval-request',
      approvalId: 'approval-1',
      toolCallId: 'tool-1',
    })
    controlled.write({ type: 'text-start', id: 'partial-text' })
    controlled.write({ type: 'text-delta', id: 'partial-text', delta: 'A partial replacement.' })
    controlled.write({ type: 'text-end', id: 'partial-text' })

    await eventually(() => {
      expect(coreMocks.replaceChatAssistantMessage).toHaveBeenCalledTimes(1)
    })

    let sawPartialText = false
    while (!sawPartialText) {
      const { done, value } = await reader.read()
      if (done) throw new Error('Expected partial regenerated text before the stream rejection.')
      sawPartialText = value.type === 'text-delta' && value.delta === 'A partial replacement.'
    }
    controlled.fail(new Error('transport stream rejected'))
    try {
      while (!(await reader.read()).done) {
        // Drain any wrapper error chunk emitted after the raw reader rejects.
      }
    } catch {
      // A rejected returned stream is also valid; persistence must still skip it.
    }
    await settleBackgroundWork()

    expect(coreMocks.replaceChatAssistantMessage).toHaveBeenCalledTimes(2)
    expect(coreMocks.replaceChatAssistantMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: priorAssistant.id,
        contentText: 'The prior answer.',
        status: 'done',
      }),
      databaseIdentity,
    )
    expect(coreMocks.appendChatMessage).not.toHaveBeenCalled()
  })

  it('does not let a delayed prior turn overwrite a newer regeneration of the same assistant', async () => {
    const priorAssistant: UIMessage = {
      id: 'assistant-shared',
      role: 'assistant',
      parts: [{ type: 'text', text: 'The persisted answer.', state: 'done' }],
    }
    const oldStream = controlledRawMessageStream()
    const newStream = controlledRawMessageStream()
    aiMocks.streamText
      .mockReturnValueOnce({ toUIMessageStream: () => oldStream.stream })
      .mockReturnValueOnce({ toUIMessageStream: () => newStream.stream })
    coreMocks.listMessages.mockResolvedValue([
      persistedMessage(userMessage),
      persistedMessage(priorAssistant),
    ])
    const transport = createChatTransport()

    const delayedResponse = await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: priorAssistant.id,
      messages: [userMessage, priorAssistant],
      abortSignal: undefined,
    })
    const regeneratedResponse = await transport.sendMessages({
      trigger: 'regenerate-message',
      chatId: 'chat-1',
      messageId: priorAssistant.id,
      messages: [userMessage],
      abortSignal: undefined,
    })

    oldStream.write({ type: 'start', messageId: priorAssistant.id })
    oldStream.write({ type: 'text-start', id: 'old-text' })
    oldStream.write({ type: 'text-delta', id: 'old-text', delta: 'Delayed old answer.' })
    oldStream.write({ type: 'text-end', id: 'old-text' })
    oldStream.write({ type: 'finish', finishReason: 'stop' })
    oldStream.close()
    await lastMessageFrom(delayedResponse)

    expect(coreMocks.appendChatMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ contentText: 'Delayed old answer.' }),
      databaseIdentity,
    )

    newStream.write({ type: 'start', messageId: priorAssistant.id })
    newStream.write({ type: 'text-start', id: 'new-text' })
    newStream.write({ type: 'text-delta', id: 'new-text', delta: 'Current regenerated answer.' })
    newStream.write({ type: 'text-end', id: 'new-text' })
    newStream.write({ type: 'finish', finishReason: 'stop' })
    newStream.close()
    await lastMessageFrom(regeneratedResponse)

    await eventually(() => {
      expect(coreMocks.replaceChatAssistantMessage).toHaveBeenCalledWith(
        expect.objectContaining({ contentText: 'Current regenerated answer.' }),
        databaseIdentity,
      )
    })
    expect(coreMocks.replaceChatAssistantMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ contentText: 'Delayed old answer.' }),
      databaseIdentity,
    )
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
    expect(coreMocks.listMessages).not.toHaveBeenCalled()
    expect(coreMocks.replaceChatAssistantMessage).not.toHaveBeenCalled()
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
