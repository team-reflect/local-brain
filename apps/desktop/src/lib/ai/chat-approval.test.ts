import { QueryClient } from '@tanstack/react-query'
import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  handleChatToolApprovalResponse,
  rememberChatApprovalDatabaseIdentity,
} from './chat-approval'

const coreMocks = vi.hoisted(() => ({
  activeDatabaseIdentity: vi.fn(),
  assertActiveDatabaseIdentity: vi.fn(),
  appendChatMessage: vi.fn(),
  executeChatWriteTool: vi.fn(),
  isChatWriteToolName: vi.fn(),
  updateChatMessageSnapshot: vi.fn(),
}))

const queryMocks = vi.hoisted(() => ({
  invalidateChatTurnQueries: vi.fn(),
}))

vi.mock('@local-brain/core', () => ({
  activeDatabaseIdentity: coreMocks.activeDatabaseIdentity,
  assertActiveDatabaseIdentity: coreMocks.assertActiveDatabaseIdentity,
  appendChatMessage: coreMocks.appendChatMessage,
  executeChatWriteTool: coreMocks.executeChatWriteTool,
  isAppError: (value: unknown) =>
    typeof value === 'object' && value !== null && 'kind' in value && 'message' in value,
  isChatWriteToolName: coreMocks.isChatWriteToolName,
  updateChatMessageSnapshot: coreMocks.updateChatMessageSnapshot,
}))

vi.mock('../queries', () => ({
  invalidateChatTurnQueries: queryMocks.invalidateChatTurnQueries,
}))

function pendingTaskMessage(): UIMessage {
  return {
    id: 'assistant-1',
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
}

function userMessage(id: string): UIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', text: 'Another request', state: 'done' }],
  }
}

function firstToolPart(messages: readonly UIMessage[]): Record<string, unknown> {
  const message = messages[0]
  if (!message) throw new Error('Expected a message.')
  const part = message.parts[0]
  if (!part) throw new Error('Expected a tool part.')
  return part as Record<string, unknown>
}

function approvalOptions(
  queryClient: QueryClient,
  getMessages: () => readonly UIMessage[],
  setMessages: (messages: UIMessage[]) => void,
) {
  return {
    chatId: 'chat-1',
    getMessages,
    queryClient,
    setMessages,
    addToolApprovalResponse: vi.fn(),
  }
}

describe('handleChatToolApprovalResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rememberChatApprovalDatabaseIdentity('approval-1', {
      databasePath: '/test/brain.sqlite',
      generation: 1,
    })
    coreMocks.activeDatabaseIdentity.mockResolvedValue({
      databasePath: '/test/brain.sqlite',
      generation: 2,
    })
    coreMocks.assertActiveDatabaseIdentity.mockResolvedValue(undefined)
    coreMocks.appendChatMessage.mockResolvedValue('message-id')
    coreMocks.executeChatWriteTool.mockResolvedValue({ kind: 'task', action: 'created', id: 'task-1' })
    coreMocks.isChatWriteToolName.mockImplementation((toolName: string) => toolName === 'create_task')
    coreMocks.updateChatMessageSnapshot.mockResolvedValue(1)
  })

  it('applies approved write output to the latest chat messages after async execution', async () => {
    let currentMessages: UIMessage[] = [pendingTaskMessage()]
    let resolveTool: (output: Record<string, unknown>) => void = (_output) => {
      throw new Error('Expected executeChatWriteTool to start.')
    }
    coreMocks.executeChatWriteTool.mockReturnValueOnce(new Promise<Record<string, unknown>>((resolve) => {
      resolveTool = resolve
    }))
    const setMessages = vi.fn((messages: UIMessage[]) => {
      currentMessages = messages
    })

    const approval = handleChatToolApprovalResponse(
      { id: 'approval-1', approved: true },
      approvalOptions(new QueryClient(), () => currentMessages, setMessages),
    )

    await vi.waitFor(() => {
      expect(firstToolPart(currentMessages)).toMatchObject({ state: 'approval-responded' })
    })
    currentMessages = [...currentMessages, userMessage('user-2')]
    resolveTool({ kind: 'task', action: 'created', id: 'task-1' })
    await approval

    expect(currentMessages).toHaveLength(2)
    expect(currentMessages[1]?.id).toBe('user-2')
    expect(firstToolPart(currentMessages)).toMatchObject({
      state: 'output-available',
      approval: { id: 'approval-1', approved: true },
      output: { kind: 'task', action: 'created', id: 'task-1' },
    })
    const ackPersistOrder = coreMocks.updateChatMessageSnapshot.mock.invocationCallOrder[0]
    const executeOrder = coreMocks.executeChatWriteTool.mock.invocationCallOrder[0]
    if (ackPersistOrder === undefined || executeOrder === undefined) {
      throw new Error('Expected persistence and execution calls.')
    }
    expect(ackPersistOrder).toBeLessThan(executeOrder)
    expect(coreMocks.executeChatWriteTool).toHaveBeenCalledWith(
      'create_task',
      { title: 'Send budget' },
      { databasePath: '/test/brain.sqlite', generation: 1 },
    )
  })

  it('settles locally without executing when the approval acknowledgement cannot be persisted', async () => {
    let currentMessages: UIMessage[] = [pendingTaskMessage()]
    const setMessages = vi.fn((messages: UIMessage[]) => {
      currentMessages = messages
    })
    coreMocks.updateChatMessageSnapshot.mockRejectedValueOnce(new Error('disk full'))

    await expect(handleChatToolApprovalResponse(
      { id: 'approval-1', approved: true },
      approvalOptions(new QueryClient(), () => currentMessages, setMessages),
    )).resolves.toBeUndefined()

    expect(coreMocks.executeChatWriteTool).not.toHaveBeenCalled()
    expect(firstToolPart(currentMessages)).toMatchObject({
      state: 'output-error',
      approval: { id: 'approval-1', approved: true },
      errorText: 'Could not save this approval. Retry the request.',
    })
  })

  it('renders structured IPC failures with their human message', async () => {
    let currentMessages: UIMessage[] = [pendingTaskMessage()]
    coreMocks.executeChatWriteTool.mockRejectedValueOnce({
      kind: 'io',
      message: 'database is read-only',
    })

    await handleChatToolApprovalResponse(
      { id: 'approval-1', approved: true },
      approvalOptions(
        new QueryClient(),
        () => currentMessages,
        (messages) => {
          currentMessages = messages
        },
      ),
    )

    expect(firstToolPart(currentMessages)).toMatchObject({
      state: 'output-error',
      errorText: 'database is read-only',
    })
  })

  it('settles a reloaded approval as a visible retryable failure without executing it', async () => {
    const message = pendingTaskMessage()
    const part = message.parts[0] as unknown as Record<string, unknown>
    part['approval'] = { id: 'approval-reloaded' }
    let currentMessages: UIMessage[] = [message]

    const options = approvalOptions(
      new QueryClient(),
      () => currentMessages,
      (messages) => {
        currentMessages = messages
      },
    )
    await expect(handleChatToolApprovalResponse(
      { id: 'approval-reloaded', approved: true },
      { ...options, expectedDatabasePath: '/test/brain.sqlite' },
    )).resolves.toBeUndefined()

    expect(coreMocks.executeChatWriteTool).not.toHaveBeenCalled()
    expect(coreMocks.updateChatMessageSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'done' }),
      { databasePath: '/test/brain.sqlite', generation: 2 },
    )
    expect(firstToolPart(currentMessages)).toMatchObject({
      state: 'output-error',
      approval: { id: 'approval-reloaded', approved: true },
      errorText: 'This approval is no longer valid. Retry the request.',
    })
  })

  it('allows a reloaded approval to be denied in the still-active brain', async () => {
    const message = pendingTaskMessage()
    const part = message.parts[0] as unknown as Record<string, unknown>
    part['approval'] = { id: 'approval-reloaded-deny' }
    let currentMessages: UIMessage[] = [message]
    const options = approvalOptions(
      new QueryClient(),
      () => currentMessages,
      (messages) => {
        currentMessages = messages
      },
    )

    await handleChatToolApprovalResponse(
      { id: 'approval-reloaded-deny', approved: false },
      { ...options, expectedDatabasePath: '/test/brain.sqlite' },
    )

    expect(coreMocks.executeChatWriteTool).not.toHaveBeenCalled()
    expect(coreMocks.activeDatabaseIdentity).toHaveBeenCalledTimes(1)
    expect(coreMocks.updateChatMessageSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'done' }),
      { databasePath: '/test/brain.sqlite', generation: 2 },
    )
    expect(firstToolPart(currentMessages)).toMatchObject({
      state: 'output-denied',
      approval: { id: 'approval-reloaded-deny', approved: false },
    })
  })

  it('does not write to a newly active brain when the brain switches after approval acknowledgement', async () => {
    let currentMessages: UIMessage[] = [pendingTaskMessage()]
    let currentGeneration = 1
    let mutations = 0
    const staleError = Object.assign(new Error('The active brain changed.'), { kind: 'stale' })
    const setMessages = vi.fn((messages: UIMessage[]) => {
      currentMessages = messages
    })
    coreMocks.updateChatMessageSnapshot.mockImplementation(
      async (_snapshot: unknown, identity: { generation: number }) => {
        if (identity.generation !== currentGeneration) throw staleError
        currentGeneration = 2
        return 1
      },
    )
    coreMocks.executeChatWriteTool.mockImplementation(
      async (_toolName: string, _input: unknown, identity: { generation: number }) => {
        if (identity.generation !== currentGeneration) throw staleError
        mutations += 1
        return { kind: 'task', action: 'created', id: 'task-1' }
      },
    )

    await expect(
      handleChatToolApprovalResponse(
        { id: 'approval-1', approved: true },
        approvalOptions(new QueryClient(), () => currentMessages, setMessages),
      ),
    ).rejects.toMatchObject({ kind: 'stale' })

    expect(mutations).toBe(0)
    expect(coreMocks.executeChatWriteTool).toHaveBeenCalledWith(
      'create_task',
      { title: 'Send budget' },
      { databasePath: '/test/brain.sqlite', generation: 1 },
    )
    expect(firstToolPart(currentMessages)).toMatchObject({
      state: 'output-error',
      approval: { id: 'approval-1', approved: true },
      errorText: 'The active brain changed.',
    })
  })

  it('keeps a successful tool output when persisting the assistant snapshot fails', async () => {
    let currentMessages: UIMessage[] = [pendingTaskMessage()]
    const setMessages = vi.fn((messages: UIMessage[]) => {
      currentMessages = messages
    })
    coreMocks.updateChatMessageSnapshot.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('disk full'))

    await expect(
      handleChatToolApprovalResponse(
        { id: 'approval-1', approved: true },
        approvalOptions(new QueryClient(), () => currentMessages, setMessages),
      ),
    ).rejects.toThrow('disk full')

    expect(firstToolPart(currentMessages)).toMatchObject({
      state: 'output-available',
      approval: { id: 'approval-1', approved: true },
      output: { kind: 'task', action: 'created', id: 'task-1' },
    })
  })

  it('keeps a denied approval denied when persisting the assistant snapshot fails', async () => {
    let currentMessages: UIMessage[] = [pendingTaskMessage()]
    const setMessages = vi.fn((messages: UIMessage[]) => {
      currentMessages = messages
    })
    coreMocks.updateChatMessageSnapshot.mockRejectedValueOnce(new Error('disk full'))

    await expect(
      handleChatToolApprovalResponse(
        { id: 'approval-1', approved: false },
        approvalOptions(new QueryClient(), () => currentMessages, setMessages),
      ),
    ).rejects.toThrow('disk full')

    expect(coreMocks.executeChatWriteTool).not.toHaveBeenCalled()
    expect(firstToolPart(currentMessages)).toMatchObject({
      state: 'output-denied',
      approval: { id: 'approval-1', approved: false },
    })
  })
})
