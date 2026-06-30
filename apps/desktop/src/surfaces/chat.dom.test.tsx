// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { UIMessage } from 'ai'
import { QueryClient } from '@tanstack/react-query'
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

const transportMocks = vi.hoisted(() => ({
  options: null as {
    modelSelection?: { configId: string; modelId: string } | null
    onConversationTitleUpdated?: (conversationId: string) => void
  } | null,
  transport: {
    sendMessages: vi.fn(),
    reconnectToStream: vi.fn(),
  },
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

vi.mock('../lib/ai/chat-transport', () => ({
  createChatTransport: (options?: {
    modelSelection?: { configId: string; modelId: string } | null
    onConversationTitleUpdated?: (conversationId: string) => void
  }) => {
    transportMocks.options = options ?? null
    return transportMocks.transport
  },
}))

const assistantMessage = (id: string, text: string, state: 'done' | 'streaming' = 'done'): UIMessage => ({
  id,
  role: 'assistant',
  parts: [{ type: 'text', text, state }],
})

const userMessage = (id: string, text: string): UIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text }],
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

function triggerChatRender(value: string): void {
  fireEvent.change(screen.getByLabelText('Chat message'), { target: { value } })
}

function expectThinkingIndicator(): void {
  const thinking = screen.getByLabelText('Thinking')
  const thinkingText = thinking.querySelector('[data-slot="marker-content"]')

  expect(thinking).not.toBeNull()
  expect(thinkingText?.textContent).toBe('Thinking…')
  expect(thinkingText?.classList.contains('animate-pulse')).toBe(true)
}

describe('ChatSurface', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/chat')
    chatMocks.messages = []
    chatMocks.status = 'ready'
    chatMocks.useChatConfig = null
    chatMocks.setMessages.mockImplementation(() => undefined)
    transportMocks.options = null
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

    const textarea = screen.getByLabelText('Chat message')
    expect(textarea.getAttribute('placeholder')).toBeNull()

    fireEvent.change(textarea, {
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

  it('invalidates the conversation rail when a generated title is saved', async () => {
    await renderReadyChat()
    const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries')

    transportMocks.options?.onConversationTitleUpdated?.('chat-1')

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['chat-conversations'] })
    invalidateSpy.mockRestore()
  })

  it('lets the chat composer choose another configured provider model', async () => {
    await renderReadyChat()

    const modelSelect = screen.getByLabelText('Model') as HTMLSelectElement
    const mini = Array.from(modelSelect.options).find((option) => option.text === 'GPT-5.4 mini')
    expect(mini).toBeDefined()
    if (!mini) throw new Error('Expected GPT-5.4 mini to be available.')

    fireEvent.change(modelSelect, { target: { value: mini.value } })

    await waitFor(() =>
      expect(transportMocks.options?.modelSelection).toEqual({
        configId: 'provider-1',
        modelId: 'gpt-5.4-mini',
      }),
    )
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

    const reasoning = screen.getByText('Checking local context…').closest('[data-slot="marker"]')

    expect(reasoning?.classList.contains('text-xs')).toBe(true)
    expect(screen.queryByLabelText('Thinking')).toBeNull()
  })

  it('shows Thinking indicator when streaming but no content yet', async () => {
    chatMocks.status = 'streaming'
    chatMocks.messages = [
      { id: 'a1', role: 'assistant', parts: [] } as unknown as UIMessage,
    ]
    await renderReadyChat()

    expectThinkingIndicator()
  })

  it('shows Thinking indicator when submitted (before streaming starts)', async () => {
    chatMocks.status = 'submitted'
    chatMocks.messages = []
    await renderReadyChat()

    expectThinkingIndicator()
  })

  it('renders messages inside the shadcn message scroller', async () => {
    chatMocks.messages = [assistantMessage('a1', 'Initial answer')]
    await renderReadyChat()

    const scroller = screen.getByLabelText('Chat messages')
    const scrollButton = screen.getByRole('button', { name: 'Scroll to end' })

    expect(scroller.getAttribute('data-slot')).toBe('message-scroller-viewport')
    expect(scrollButton.getAttribute('data-slot')).toBe('message-scroller-button')
    expect(screen.getByText('Initial answer')).not.toBeNull()
  })

  it('updates streaming content inside the shadcn message scroller', async () => {
    chatMocks.messages = [assistantMessage('a1', 'Initial answer')]
    await renderReadyChat()

    chatMocks.status = 'streaming'
    chatMocks.messages = [assistantMessage('a1', 'Initial answer with more streamed content', 'streaming')]
    triggerChatRender('tick')

    expect(screen.getByText('Initial answer with more streamed content')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Scroll to end' })).not.toBeNull()
  })

  it('renders a newly submitted user message as a scroller item', async () => {
    chatMocks.messages = [assistantMessage('a1', 'Initial answer')]
    await renderReadyChat()

    chatMocks.messages = [assistantMessage('a1', 'Initial answer'), userMessage('u1', 'Follow up')]
    triggerChatRender('follow up')

    const scrollerItems = document.querySelectorAll('[data-slot="message-scroller-item"]')

    expect(screen.getByText('Follow up')).not.toBeNull()
    expect(scrollerItems.length).toBe(2)
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

  it('executes approved write tools immediately and updates the approval chip', async () => {
    const calls: Array<{ command: string; args: Record<string, unknown> }> = []
    installFakeBridge({
      respond: (command, args) => {
        calls.push({ command, args })
        return undefined
      },
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

    expect(screen.getByText('Create task')).not.toBeNull()
    expect(screen.getByText('Send budget')).not.toBeNull()
    expect(screen.queryByText('Approve')).toBeNull()
    const approveButton = screen.getByRole('button', { name: /Approve create task/ })
    fireEvent.click(approveButton)
    fireEvent.click(approveButton)

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.command === 'db_execute' &&
            String(call.args['sql']).includes('insert into "tasks"'),
        ),
      ).toBe(true),
    )
    expect(
      calls.filter(
        (call) =>
          call.command === 'db_execute' &&
          String(call.args['sql']).includes('insert into "tasks"'),
      ),
    ).toHaveLength(1)
    await waitFor(() => expect(chatMocks.setMessages).toHaveBeenCalled())
    const nextMessages = chatMocks.setMessages.mock.calls.at(-1)?.[0] as UIMessage[]
    const nextPart = nextMessages[0]?.parts[0] as Record<string, unknown> | undefined
    expect(nextPart).toMatchObject({
      type: 'tool-create_task',
      state: 'output-available',
      approval: { id: 'approval-1', approved: true },
      output: { kind: 'task', action: 'created' },
    })
    await waitFor(() =>
      expect(
        calls.some(
          (call) => {
            const statements = call.args['statements']
            return call.command === 'db_batch' &&
              Array.isArray(statements) &&
              statements.some(
                (statement) =>
                  typeof statement === 'object' &&
                  statement !== null &&
                  String((statement as Record<string, unknown>)['sql']).includes('update "chat_messages"'),
              )
          },
        ),
      ).toBe(true),
    )
    expect(chatMocks.addToolApprovalResponse).not.toHaveBeenCalled()
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
    const config = chatMocks.useChatConfig as {
      sendAutomaticallyWhen?: (options: { messages: UIMessage[] }) => boolean
    }
    expect(config.sendAutomaticallyWhen?.({ messages: chatMocks.messages })).toBe(false)
    expect(textarea).toHaveProperty('disabled', false)
    expect(sendButton).toHaveProperty('disabled', true)
    fireEvent.change(textarea, { target: { value: 'Start a new turn' } })
    expect(textarea).toHaveProperty('value', 'Start a new turn')
    fireEvent.click(sendButton)
    expect(chatMocks.sendMessage).not.toHaveBeenCalled()
  })

  it('keeps the input editable but blocks submit while an approved write tool is executing', async () => {
    let insertStarted = false
    let resolveInsert: () => void = () => {
      throw new Error('Expected task insert to be pending.')
    }
    installFakeBridge({
      respond: (command, args) => {
        if (command === 'db_execute' && String(args['sql']).includes('insert into "tasks"')) {
          insertStarted = true
          return new Promise<number>((resolve) => {
            resolveInsert = () => resolve(1)
          })
        }
        return undefined
      },
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
    chatMocks.setMessages.mockImplementation((messages: UIMessage[]) => {
      chatMocks.messages = messages
    })
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

    fireEvent.click(screen.getByRole('button', { name: /Approve create task/ }))
    await waitFor(() => expect(insertStarted).toBe(true))
    await waitFor(() => {
      const message = chatMocks.messages[0]
      const part = message?.parts[0] as Record<string, unknown> | undefined
      expect(part).toMatchObject({ state: 'approval-responded' })
    })

    const textarea = screen.getByLabelText('Chat message')
    const sendButton = screen.getByRole('button', { name: /Send/ })
    expect(textarea).toHaveProperty('disabled', false)
    expect(sendButton).toHaveProperty('disabled', true)
    fireEvent.change(textarea, { target: { value: 'Start a new turn' } })
    expect(textarea).toHaveProperty('value', 'Start a new turn')
    fireEvent.click(sendButton)
    expect(chatMocks.sendMessage).not.toHaveBeenCalled()

    resolveInsert()
    await waitFor(() => {
      const message = chatMocks.messages[0]
      const part = message?.parts[0] as Record<string, unknown> | undefined
      expect(part).toMatchObject({ state: 'output-available' })
    })
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

  it('deletes the active conversation from the rail after confirmation', async () => {
    const calls: Array<{ command: string; args: Record<string, unknown> }> = []
    installFakeBridge({
      respond: (command, args) => {
        calls.push({ command, args })
        return undefined
      },
      query: (sql, params) => {
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
        if (sql.includes('from "chat_conversations"')) {
          return [
            {
              id: 'chat-1',
              title: 'Northwind planning',
              createdAt: '2026-06-21T00:00:00.000Z',
              updatedAt: '2026-06-21T00:00:00.000Z',
              archivedAt: null,
            },
          ]
        }
        if (sql.includes('from "chat_messages"')) return []
        return []
      },
    })
    window.history.replaceState({}, '', '/chat?conversation=chat-1')

    renderWithProviders(<ChatSurface conversationId="chat-1" />)

    expect(await screen.findByText('Northwind planning')).not.toBeNull()
    const actionsButton = screen.getByLabelText('Conversation actions for Northwind planning')
    actionsButton.focus()
    fireEvent.keyDown(actionsButton, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete conversation/ }))
    expect(await screen.findByText('Delete conversation?')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.command === 'db_execute' &&
            String(call.args['sql']).includes('update "chat_conversations"') &&
            ((call.args['params'] as unknown[]) ?? []).includes('chat-1'),
        ),
      ).toBe(true),
    )
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/chat'))
    expect(chatMocks.setMessages).toHaveBeenCalledWith([])
  })
})
