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
})
