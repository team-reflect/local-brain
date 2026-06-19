// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { UIMessage } from 'ai'
import { AskSurface } from './ask'
import { installFakeBridge, renderWithProviders } from '../test/utils'

const chatMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  setMessages: vi.fn(),
  messages: [] as UIMessage[],
  status: 'ready' as string,
}))

vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    error: undefined,
    messages: chatMocks.messages,
    sendMessage: chatMocks.sendMessage,
    setMessages: chatMocks.setMessages,
    status: chatMocks.status,
  }),
}))

const assistantMessage = (id: string, text: string, state: 'done' | 'streaming' = 'done'): UIMessage => ({
  id,
  role: 'assistant',
  parts: [{ type: 'text', text, state }],
})

const toolMessage = (id: string, toolName: string, state: string, input: Record<string, unknown>, output?: Record<string, unknown>): UIMessage =>
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
      },
    ],
  }) as unknown as UIMessage

describe('AskSurface', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chatMocks.messages = []
    chatMocks.status = 'ready'
    chatMocks.sendMessage.mockResolvedValue(undefined)
    installFakeBridge({ queryRows: [] })
  })

  it('sends a new UI message instead of replacing a missing message id', async () => {
    renderWithProviders(<AskSurface conversationId={undefined} />)

    fireEvent.change(screen.getByLabelText('Ask message'), {
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

  it('renders settled assistant text as markdown (bold and list)', () => {
    chatMocks.messages = [
      assistantMessage('a1', '**Bold** answer.\n\n- item one\n- item two'),
    ]
    renderWithProviders(<AskSurface conversationId={undefined} />)

    // react-markdown should turn **Bold** into a <strong> element
    expect(screen.getByText('Bold')).not.toBeNull()
    // List items should be rendered
    expect(screen.getByText('item one')).not.toBeNull()
    expect(screen.getByText('item two')).not.toBeNull()
  })

  it('renders streaming assistant text as plain text, not markdown', () => {
    chatMocks.status = 'streaming'
    chatMocks.messages = [
      assistantMessage('a1', '**Bold** text still streaming', 'streaming'),
    ]
    renderWithProviders(<AskSurface conversationId={undefined} />)

    // Should be in a plain pre-wrap div, not converted to <strong>
    const boldEl = screen.queryByText('Bold')
    expect(boldEl).toBeNull()
    expect(screen.getByText('**Bold** text still streaming')).not.toBeNull()
  })

  it('hides the Thinking indicator once streaming content is visible', () => {
    chatMocks.status = 'streaming'
    chatMocks.messages = [
      assistantMessage('a1', 'Here is what I found…', 'streaming'),
    ]
    renderWithProviders(<AskSurface conversationId={undefined} />)

    expect(screen.queryByLabelText('Thinking')).toBeNull()
  })

  it('shows Thinking indicator when streaming but no content yet', () => {
    chatMocks.status = 'streaming'
    chatMocks.messages = [
      { id: 'a1', role: 'assistant', parts: [] } as unknown as UIMessage,
    ]
    renderWithProviders(<AskSurface conversationId={undefined} />)

    expect(screen.getByLabelText('Thinking')).not.toBeNull()
  })

  it('shows Thinking indicator when submitted (before streaming starts)', () => {
    chatMocks.status = 'submitted'
    chatMocks.messages = []
    renderWithProviders(<AskSurface conversationId={undefined} />)

    expect(screen.getByLabelText('Thinking')).not.toBeNull()
  })

  it('renders a pending search_records tool chip', () => {
    chatMocks.messages = [
      toolMessage('a1', 'search_records', 'input-available', { query: 'Maya budget' }),
    ]
    renderWithProviders(<AskSurface conversationId={undefined} />)

    expect(screen.getByText(/Searched "Maya budget"/)).not.toBeNull()
  })

  it('renders a settled search_records tool chip with count', () => {
    chatMocks.messages = [
      toolMessage(
        'a1',
        'search_records',
        'output-available',
        { query: 'Maya budget' },
        { hits: [{ recordType: 'interaction', recordId: 'i1', title: 'Call with Maya', snippet: 'budget' }], count: 1 },
      ),
    ]
    renderWithProviders(<AskSurface conversationId={undefined} />)

    expect(screen.getByText(/Searched "Maya budget"/)).not.toBeNull()
    expect(screen.getByText(/1 result/)).not.toBeNull()
  })

  it('renders a list_projects tool chip', () => {
    chatMocks.messages = [
      toolMessage('a1', 'list_projects', 'output-available', {}, { projects: [], count: 3 }),
    ]
    renderWithProviders(<AskSurface conversationId={undefined} />)

    expect(screen.getByText(/Listed projects/)).not.toBeNull()
    expect(screen.getByText(/3 projects/)).not.toBeNull()
  })

  it('renders persisted tool chip correctly (reloaded conversation)', () => {
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
    renderWithProviders(<AskSurface conversationId={undefined} />)

    expect(screen.getByText(/Searched "Atlas deadline"/)).not.toBeNull()
    expect(screen.getByText(/0 results/)).not.toBeNull()
  })
})
