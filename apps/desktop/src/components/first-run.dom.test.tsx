// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { FirstRun } from './first-run'
import { installFakeBridge, renderWithProviders } from '../test/utils'

// Completion is install-scoped (localStorage), not per-brain. jsdom's default
// opaque origin has no localStorage, so back it with an in-memory stub that
// survives across renders the way the real webview store survives brain swaps.
const store = new Map<string, string>()

describe('FirstRun onboarding', () => {
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    store.clear()
  })

  it('shows the welcome on a fresh install (no completed flag)', async () => {
    installFakeBridge({ queryRows: [] })
    renderWithProviders(<FirstRun />)
    await waitFor(() => expect(screen.getByText('Welcome to Local Brain')).toBeDefined())
    expect(screen.getByText('Get started')).toBeDefined()
  })

  it('stays hidden once first run is completed (install-scoped flag)', async () => {
    store.set('firstRun.completed', 'true')
    installFakeBridge({ queryRows: [] })
    renderWithProviders(<FirstRun />)
    // Give the query a tick; the overlay must not appear.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText('Welcome to Local Brain')).toBeNull()
  })

  it('does not reappear for a different brain after being dismissed', async () => {
    // Regression: completion lived in the per-brain settings DB, so a new/other
    // brain (with no row) re-showed onboarding. The flag is now install-scoped,
    // so dismissing it on one brain must keep it hidden on any other brain.
    installFakeBridge({ queryRows: [] }) // any brain DB: no settings row
    const first = renderWithProviders(<FirstRun />)
    await waitFor(() => expect(screen.getByText('Welcome to Local Brain')).toBeDefined())
    fireEvent.click(screen.getByText('Get started'))
    await waitFor(() => expect(screen.queryByText('Welcome to Local Brain')).toBeNull())
    first.unmount()

    // Switch to a different brain: remount against a fresh DB with no row.
    installFakeBridge({ queryRows: [] })
    renderWithProviders(<FirstRun />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText('Welcome to Local Brain')).toBeNull()
  })
})
