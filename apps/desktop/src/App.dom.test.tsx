// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { App } from './App'

// Isolate App's gate: stub the heavy workspace, the router, and the chooser so
// the test exercises only the open-brain-vs-chooser decision, not the shell.
vi.mock('./components/app-shell', () => ({
  AppShell: () => <div data-testid="workspace">workspace</div>,
}))
vi.mock('./components/brain-chooser', () => ({
  BrainChooser: ({ errorMessage }: { errorMessage?: string | null }) => (
    <div data-testid="chooser">
      {errorMessage ? <p role="alert">{errorMessage}</p> : 'chooser'}
    </div>
  ),
}))
vi.mock('./routing/router', () => ({
  RouterProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

// Drive the active-brain query result directly. The gate is a pure decision over
// `useActiveBrain()`'s result, and the case that distinguishes "transient error"
// from "no brain" is `isError: true` *with* data still present — TanStack Query
// retains the last successful `active-brain` data when a background refetch
// fails, so the hook can report an error while a brain is still open. Driving the
// hook is the only way to exercise that exact combination deterministically.
const activeBrainResult = { value: undefined as unknown }
vi.mock('./lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/queries')>()
  return {
    ...actual,
    useActiveBrain: () => activeBrainResult.value,
    // The seeded workspace runs useEnsureSeed on mount; make it a no-op so the
    // gate test needs no ingest bridge wiring.
    useEnsureSeed: () => undefined,
  }
})

const ACTIVE = {
  rootPath: '/data/My brain',
  databasePath: '/data/My brain/brain.sqlite',
  assetsPath: '/data/My brain/assets',
  name: 'My brain',
  color: 'indigo',
  createdMs: 1,
  lastOpenedMs: 2,
  isActive: true,
  schemaVersion: 2,
}

function renderApp(result: unknown) {
  activeBrainResult.value = result
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
}

afterEach(() => cleanup())

describe('App active-brain gate', () => {
  it('keeps the workspace mounted when a refetch errors but a brain is still open', () => {
    // Regression: a transient IPC/validation failure on a background refetch
    // surfaces as isError while TanStack Query keeps the last successful data.
    // The gate must not drop the user into the chooser while Rust has a brain.
    renderApp({ isPending: false, isError: true, data: ACTIVE })

    expect(screen.getByTestId('workspace')).toBeTruthy()
    expect(screen.queryByTestId('chooser')).toBeNull()
  })

  it('shows the chooser when there is genuinely no active brain', () => {
    // Initial resolution produced no brain.
    renderApp({ isPending: false, isError: false, data: null })

    expect(screen.getByTestId('chooser')).toBeTruthy()
    expect(screen.queryByTestId('workspace')).toBeNull()
  })

  it('shows the chooser with the startup database error when the remembered brain fails to open', () => {
    renderApp({
      isPending: false,
      isError: true,
      data: undefined,
      error: {
        kind: 'noDatabase',
        message: 'Could not open the remembered brain at /Brains/Home: database disk image is malformed',
      },
    })

    expect(screen.getByTestId('chooser')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('database disk image is malformed')
    expect(screen.queryByTestId('workspace')).toBeNull()
  })

  it('mounts the workspace for a healthy resolved brain', () => {
    renderApp({ isPending: false, isError: false, data: ACTIVE })

    expect(screen.getByTestId('workspace')).toBeTruthy()
    expect(screen.queryByTestId('chooser')).toBeNull()
  })

  it('waits while the initial brain connection is still pending', () => {
    renderApp({ isPending: true, isError: false, data: undefined })

    expect(screen.queryByTestId('workspace')).toBeNull()
    expect(screen.queryByTestId('chooser')).toBeNull()
  })
})
