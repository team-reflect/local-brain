// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { setModelProvider } from '@local-brain/core'
import { AskSurface } from './ask'
import { installFakeBridge, renderWithProviders } from '../test/utils'

describe('AskSurface model boundary', () => {
  beforeEach(() => {
    setModelProvider(null) // no BYOK provider configured
    installFakeBridge({ queryRows: [] })
  })

  it('surfaces the closed-boundary reason when no provider is configured', async () => {
    renderWithProviders(<AskSurface conversationId={undefined} />)
    await waitFor(() => expect(screen.getByText(/No model provider is configured/)).toBeDefined())
  })

  it('keeps existing messages visible when the model boundary is closed', async () => {
    installFakeBridge({
      query: (sql) => {
        if (sql.includes('chat_messages') || sql.includes('chatMessages')) {
          return [
            {
              id: 'msg-1',
              conversationId: 'chat-1',
              role: 'user',
              content: 'What did we decide?',
              model: null,
              createdAt: '2026-06-18T00:00:00.000Z',
            },
          ]
        }
        return []
      },
    })

    renderWithProviders(<AskSurface conversationId="chat-1" />)

    await waitFor(() => expect(screen.getByText('What did we decide?')).toBeDefined())
    expect(screen.queryByText(/No model provider is configured/)).toBeNull()
  })
})
