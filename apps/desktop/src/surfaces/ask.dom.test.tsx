// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { AskSurface } from './ask'
import { installFakeBridge, renderWithProviders } from '../test/utils'

const chatMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  setMessages: vi.fn(),
}))

vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    error: undefined,
    messages: [],
    sendMessage: chatMocks.sendMessage,
    setMessages: chatMocks.setMessages,
    status: 'ready',
  }),
}))

describe('AskSurface', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
