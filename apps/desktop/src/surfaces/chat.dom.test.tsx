// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { UIMessage } from 'ai'
import { ChatSurface } from './chat'
import { installFakeBridge, renderWithProviders } from '../test/utils'

const chatMocks = vi.hoisted(() => ({
  addToolApprovalResponse: vi.fn(),
  sendMessage: vi.fn(),
  setMessages: vi.fn(),
  messages: [] as UIMessage[],
  status: 'ready' as string,
  useChatConfig: null as unknown,
}))

vi.mock('@ai-sdk/react', () => ({
  useChat: (config: unknown) => {
    chatMocks.useChatConfig = config
    return {
      addToolApprovalResponse: chatMocks.addToolApprovalResponse,
      error: undefined,
      messages: chatMocks.messages,
      sendMessage: chatMocks.sendMessage,
      setMessages: chatMocks.setMessages,
      status: chatMocks.status,
    }
  },
}))

const assistantMessage = (id: string, text: string, state: 'done' | 'streaming' = 'done'): UIMessage => ({
  id,
  role: 'assistant',
  parts: [{ type: 'text', text, state }],
})

const toolMessage = (
  id: string,
  toolName: string,
  state: string,
  input: Record<string, unknown>,
  output?: Record<string, unknown>,
  approval?: Record<string, unknown>,
): UIMessage =>
  ({
    id,
    role: 'assistant',
    parts: [
      {
        type: `tool-${toolName}`,
        toolCallId: 'tc-1',
        state,
        input,
        ...(output ? { output } : {}),
        ...(approval ? { approval } : {}),
      },
    ],
  }) as unknown as UIMessage

function installChatBridgeWithProvider(): void {
  installFakeBridge({
    query: (_sql, params) => {
      const key = params[0]
      if (key === 'model.aiProviders') {
        return [
          {
            valueJson: JSON.stringify([
              { id: 'provider-1', provider: 'openai', model: 'gpt-5.1', keyHint: '12345' },
            ]),
          },
        ]
      }
      if (key === 'model.defaultAiProviderId') {
        return [{ valueJson: JSON.stringify('provider-1') }]
      }
      return []
    },
  })
}

async function renderReadyChat(): Promise<void> {
  renderWithProviders(<ChatSurface conversationId={undefined} />)
  await screen.findByLabelText('Chat message')
}

describe('ChatSurface', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/chat')
    chatMocks.messages = []
    chatMocks.status = 'ready'
    chatMocks.useChatConfig = null
    chatMocks.sendMessage.mockResolvedValue(undefined)
    installChatBridgeWithProvider()
  })

  it('prompts users to add an AI provider before chatting', async () => {
    installFakeBridge({ queryRows: [] })
    renderWithProviders(<ChatSurface conversationId={undefined} />)

    expect(screen.queryByLabelText('Chat message')).toBeNull()
    expect(await screen.findByText(/Add an AI provider to start chatting/)).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Add an AI provider' }))
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/settings?section=ai-providers'))
    expect(screen.queryByLabelText('Chat message')).toBeNull()
  })

  it('sends a new UI message instead of replacing a missing message id', async () => {
    await renderReadyChat()

    fireEvent.change(screen.getByLabelText('Chat message'), {
      target: { value: 'What changed this week?' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))

    await waitFor(() => expect(chatMocks.sendMessage).toHaveBeenCalled())
    const [message] = chatMocks.sendMessage.mock.calls[0] as [Record<string, unknown>]
    expect(message).toMatchObject({
      role: 'user',
      parts: [{ type: 'text', text: 'What changed this week?' }],
    })
    expect(message['id']).toEqual(expect.any(String))
    expect(message).not.toHaveProperty('messageId')
  })

  it('configures automatic continuation after tool approval', async () => {
    await renderReadyChat()

    const config = chatMocks.useChatConfig as Record<string, unknown>
    expect(config['sendAutomaticallyWhen']).toEqual(expect.any(Function))
  })

  it('renders settled assistant text as markdown (bold and list)', async () => {
    chatMocks.messages = [
      assistantMessage('a1', '**Bold** answer.\n\n- item one\n- item two'),
    ]
    await renderReadyChat()

    // react-markdown should turn **Bold** into a <strong> element
    expect(screen.getByText('Bold')).not.toBeNull()
    // List items should be rendered
    expect(screen.getByText('item one')).not.toBeNull()
    expect(screen.getByText('item two')).not.toBeNull()
  })

  it('renders streaming assistant text as plain text, not markdown', async () => {
    chatMocks.status = 'streaming'
    chatMocks.messages = [
      assistantMessage('a1', '**Bold** text still streaming', 'streaming'),
    ]
    await renderReadyChat()

    // Should be in a plain pre-wrap div, not converted to <strong>
    const boldEl = screen.queryByText('Bold')
    expect(boldEl).toBeNull()
    expect(screen.getByText('**Bold** text still streaming')).not.toBeNull()
  })

  it('hides the Thinking indicator once streaming content is visible', async () => {
    chatMocks.status = 'streaming'
    chatMocks.messages = [
      assistantMessage('a1', 'Here is what I found…', 'streaming'),
    ]
    await renderReadyChat()

    expect(screen.queryByLabelText('Thinking')).toBeNull()
  })

  it('hides the Thinking indicator once streaming reasoning is visible', async () => {
    chatMocks.status = 'streaming'
    chatMocks.messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'reasoning', text: 'Checking local context…' }],
      } as unknown as UIMessage,
    ]
    await renderReadyChat()

    expect(screen.getByText('Checking local context…')).not.toBeNull()
    expect(screen.queryByLabelText('Thinking')).toBeNull()
  })

  it('shows Thinking indicator when streaming but no content yet', async () => {
    chatMocks.status = 'streaming'
    chatMocks.messages = [
      { id: 'a1', role: 'assistant', parts: [] } as unknown as UIMessage,
    ]
    await renderReadyChat()

    expect(screen.getByLabelText('Thinking')).not.toBeNull()
  })

  it('shows Thinking indicator when submitted (before streaming starts)', async () => {
    chatMocks.status = 'submitted'
    chatMocks.messages = []
    await renderReadyChat()

    expect(screen.getByLabelText('Thinking')).not.toBeNull()
  })

  it('renders earlier text parts as plain text when a tool part follows during streaming', async () => {
    chatMocks.status = 'streaming'
    chatMocks.messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: '**Bold** text before tool', state: 'done' },
          {
            type: 'tool-search_records',
            toolCallId: 'tc-1',
            state: 'input-streaming',
            input: { query: 'test' },
          },
        ],
      } as unknown as UIMessage,
    ]
    await renderReadyChat()

    // Earlier text part should still be plain (not parsed as markdown) while streaming
    expect(screen.queryByText('Bold')).toBeNull()
    expect(screen.getByText('**Bold** text before tool')).not.toBeNull()
  })

  it('renders a pending search_records tool chip', async () => {
    chatMocks.messages = [
      toolMessage('a1', 'search_records', 'input-available', { query: 'Maya budget' }),
    ]
    await renderReadyChat()

    expect(screen.getByText(/Searched "Maya budget"/)).not.toBeNull()
  })

  it('renders a settled search_records tool chip with count', async () => {
    chatMocks.messages = [
      toolMessage(
        'a1',
        'search_records',
        'output-available',
        { query: 'Maya budget' },
        { hits: [{ recordType: 'interaction', recordId: 'i1', title: 'Call with Maya', snippet: 'budget' }], count: 1 },
      ),
    ]
    await renderReadyChat()

    expect(screen.getByText(/Searched "Maya budget"/)).not.toBeNull()
    expect(screen.getByText(/1 result/)).not.toBeNull()
  })

  it('renders a list_projects tool chip', async () => {
    chatMocks.messages = [
      toolMessage('a1', 'list_projects', 'output-available', {}, { projects: [], count: 3 }),
    ]
    await renderReadyChat()

    expect(screen.getByText(/Listed projects/)).not.toBeNull()
    expect(screen.getByText(/3 projects/)).not.toBeNull()
  })

  it('renders approval controls and sends approval responses', async () => {
    chatMocks.messages = [
      toolMessage(
        'a1',
        'create_task',
        'approval-requested',
        { title: 'Send budget' },
        undefined,
        { id: 'approval-1' },
      ),
    ]
    await renderReadyChat()

    expect(screen.getByText('Create task needs approval')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }))
    expect(chatMocks.addToolApprovalResponse).toHaveBeenCalledWith({ id: 'approval-1', approved: true })
  })

  it('keeps the input editable but blocks submit while tool approval is pending', async () => {
    chatMocks.messages = [
      toolMessage(
        'a1',
        'create_task',
        'approval-requested',
        { title: 'Send budget' },
        undefined,
        { id: 'approval-1' },
      ),
    ]
    await renderReadyChat()

    const textarea = screen.getByLabelText('Chat message')
    const sendButton = screen.getByRole('button', { name: /Send/ })
    expect(textarea).toHaveProperty('disabled', false)
    expect(sendButton).toHaveProperty('disabled', true)
    fireEvent.change(textarea, { target: { value: 'Start a new turn' } })
    expect(textarea).toHaveProperty('value', 'Start a new turn')
    fireEvent.click(sendButton)
    expect(chatMocks.sendMessage).not.toHaveBeenCalled()
  })

  it('keeps the input editable but blocks submit while chat is streaming', async () => {
    chatMocks.status = 'streaming'
    chatMocks.messages = [
      assistantMessage('a1', 'Checking local context...', 'streaming'),
    ]
    await renderReadyChat()

    const textarea = screen.getByLabelText('Chat message')
    const sendButton = screen.getByRole('button', { name: /Send/ })
    expect(textarea).toHaveProperty('disabled', false)
    fireEvent.change(textarea, { target: { value: 'Follow up' } })
    expect(textarea).toHaveProperty('value', 'Follow up')
    expect(sendButton).toHaveProperty('disabled', true)
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(chatMocks.sendMessage).not.toHaveBeenCalled()
  })

  it('renders persisted tool chip correctly (reloaded conversation)', async () => {
    // Simulates messages already hydrated (e.g. restored from DB via setMessages).
    // conversationId is undefined here so displayedMessages = messages immediately.
    chatMocks.messages = [
      toolMessage(
        'a1',
        'search_records',
        'output-available',
        { query: 'Atlas deadline' },
        { hits: [], count: 0 },
      ),
    ]
    await renderReadyChat()

    expect(screen.getByText(/Searched "Atlas deadline"/)).not.toBeNull()
    expect(screen.getByText(/0 results/)).not.toBeNull()
  })
})
