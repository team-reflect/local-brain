// @vitest-environment jsdom
import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { installFakeBridge } from '../../test/utils'
import { ACTIVE_BRAIN_KEY, useCreateBrain, useOpenBrain } from './brains'

const ACTIVE = {
  path: '/data/brain.sqlite',
  name: 'My brain',
  color: 'indigo',
  createdMs: 1,
  lastOpenedMs: 2,
  isActive: true,
  schemaVersion: 2,
}
const WORK = {
  path: '/data/work.sqlite',
  name: 'Work',
  color: 'teal',
  createdMs: 1,
  lastOpenedMs: 3,
  isActive: true,
  schemaVersion: 2,
}

/**
 * Bridge that mirrors the real connection swap: `open_brain`/`create_brain`
 * make a brain active and `active_brain` reports whatever is currently active.
 */
function installSwitchableBridge(): void {
  let current = ACTIVE
  installFakeBridge({
    respond: (command) => {
      switch (command) {
        case 'active_brain':
          return current
        case 'open_brain':
        case 'create_brain':
          current = WORK
          return WORK
        default:
          return undefined
      }
    },
  })
}

function withClient(client: QueryClient) {
  return ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('brain switch cache seeding', () => {
  it('seeds active-brain with the opened brain before any refetch', async () => {
    installSwitchableBridge()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    // Prime the stale cache the app would be holding for the previous brain.
    client.setQueryData(ACTIVE_BRAIN_KEY, ACTIVE)

    const { result } = renderHook(() => useOpenBrain(), { wrapper: withClient(client) })
    await result.current.mutateAsync(WORK.path)

    // Synchronously after the mutation resolves (before invalidation refetches),
    // the cache already points at the new brain so App re-keys immediately.
    expect(client.getQueryData(ACTIVE_BRAIN_KEY)).toEqual(WORK)
  })

  it('seeds active-brain with the created brain before any refetch', async () => {
    installSwitchableBridge()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    client.setQueryData(ACTIVE_BRAIN_KEY, ACTIVE)

    const { result } = renderHook(() => useCreateBrain(), { wrapper: withClient(client) })
    await result.current.mutateAsync({ path: WORK.path, name: WORK.name })

    expect(client.getQueryData(ACTIVE_BRAIN_KEY)).toEqual(WORK)
  })
})
