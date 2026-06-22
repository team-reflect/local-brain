import { QueryClient } from '@tanstack/react-query'
import type { UIMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleChatToolApprovalResponse } from './chat-approval'

const coreMocks = vi.hoisted(() => ({
  appendChatMessage: vi.fn(),
  executeChatWriteTool: vi.fn(),
  isChatWriteToolName: vi.fn(),
  updateChatMessageSnapshot: vi.fn(),
}))

const queryMocks = vi.hoisted(() => ({
  invalidateChatTurnQueries: vi.fn(),
}))

vi.mock('@local-brain/core', () => ({
  appendChatMessage: coreMocks.appendChatMessage,
  executeChatWriteTool: coreMocks.executeChatWriteTool,
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

    expect(firstToolPart(currentMessages)).toMatchObject({ state: 'approval-responded' })
    await Promise.resolve()
    await Promise.resolve()
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
  })

  it('does not execute an approved write when the approval acknowledgement cannot be persisted', async () => {
    let currentMessages: UIMessage[] = [pendingTaskMessage()]
    const setMessages = vi.fn((messages: UIMessage[]) => {
      currentMessages = messages
    })
    coreMocks.updateChatMessageSnapshot.mockRejectedValueOnce(new Error('disk full'))

    await expect(
      handleChatToolApprovalResponse(
        { id: 'approval-1', approved: true },
        approvalOptions(new QueryClient(), () => currentMessages, setMessages),
      ),
    ).rejects.toThrow('disk full')

    expect(coreMocks.executeChatWriteTool).not.toHaveBeenCalled()
    expect(firstToolPart(currentMessages)).toMatchObject({
      state: 'approval-requested',
      approval: { id: 'approval-1' },
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
