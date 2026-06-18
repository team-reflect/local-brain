// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { FirstRun } from './first-run'
import { installFakeBridge, renderWithProviders } from '../test/utils'

describe('FirstRun onboarding', () => {
  it('shows the welcome on a fresh install (no completed flag)', async () => {
    installFakeBridge({ queryRows: [] }) // settings query returns nothing → not completed
    renderWithProviders(<FirstRun />)
    await waitFor(() => expect(screen.getByText('Welcome to Local Brain')).toBeDefined())
    expect(screen.getByText('Get started')).toBeDefined()
  })

  it('stays hidden once first run is completed', async () => {
    installFakeBridge({
      query: (sql) => (sql.includes('from "settings"') ? [{ value_json: 'true' }] : []),
    })
    renderWithProviders(<FirstRun />)
    // Give the query a tick; the overlay must not appear.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText('Welcome to Local Brain')).toBeNull()
  })
})
