// @vitest-environment jsdom
import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { installFakeBridge } from '../../test/utils'
import { ACTIVE_BRAIN_KEY, BRAINS_KEY, useCreateBrain, useOpenBrain } from './brains'

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

  it('removes stale brain-scoped caches on switch but keeps brain-picker state', async () => {
    installSwitchableBridge()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    client.setQueryData(ACTIVE_BRAIN_KEY, ACTIVE)
    // The cross-brain catalogue is brain-independent and must survive the switch.
    client.setQueryData(BRAINS_KEY, [ACTIVE])
    // Brain-scoped caches the previous brain populated — old-brain rows that must
    // not be rendered under the new brain (ids could even collide).
    client.setQueryData(['tasks'], [{ id: 'old-task', title: 'Old brain task' }])
    client.setQueryData(['people', 'p1'], { id: 'p1', name: 'Old brain person' })

    const { result } = renderHook(() => useOpenBrain(), { wrapper: withClient(client) })
    await result.current.mutateAsync(WORK.path)

    // Every brain-scoped cache is gone, so the remounted workspace fetches fresh.
    expect(client.getQueryData(['tasks'])).toBeUndefined()
    expect(client.getQueryData(['people', 'p1'])).toBeUndefined()
    // Brain-picker state is preserved and reconciled: active-brain seeded, and the
    // catalogue now flags WORK active (prepended) with the old ACTIVE cleared, so
    // the switcher never briefly shows the previous brain active.
    expect(client.getQueryData(ACTIVE_BRAIN_KEY)).toEqual(WORK)
    expect(client.getQueryData(BRAINS_KEY)).toEqual([WORK, { ...ACTIVE, isActive: false }])
  })

  it('reconciles the catalogue so only the switched-to brain is active', async () => {
    // Bugbot Medium regression: after a switch the catalogue was only invalidated,
    // so a stale snapshot kept marking the old brain active and listed the new
    // brain under "other brains" until a refetch landed. The cache must be updated
    // coherently: the switched-to brain becomes the sole active entry in place.
    installSwitchableBridge()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    client.setQueryData(ACTIVE_BRAIN_KEY, ACTIVE)
    // A catalogue already holding both brains, with the previous one flagged active
    // and WORK present-but-inactive (the common case: switching to a listed brain).
    client.setQueryData(BRAINS_KEY, [ACTIVE, { ...WORK, isActive: false }])

    const { result } = renderHook(() => useOpenBrain(), { wrapper: withClient(client) })
    await result.current.mutateAsync(WORK.path)

    const list = client.getQueryData<typeof ACTIVE[]>(BRAINS_KEY)
    expect(list).toEqual([{ ...ACTIVE, isActive: false }, WORK])
    // Exactly one active brain, and it is the one we switched to.
    expect(list?.filter((brain) => brain.isActive)).toEqual([WORK])
  })
})
