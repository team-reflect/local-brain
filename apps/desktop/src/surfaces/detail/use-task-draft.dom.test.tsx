// @vitest-environment jsdom
import { StrictMode, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { TaskWithIdentity } from '../../lib/queries'
import { describe, expect, it, vi } from 'vitest'
import { installFakeBridge } from '../../test/utils'
import { useTaskDraft } from './use-task-draft'

const task: TaskWithIdentity = {
  databaseIdentity: { databasePath: '/original/brain.sqlite', generation: 1 },
  id: 'task-1',
  title: 'Original title',
  description: null,
  status: 'open',
  priority: null,
  projectId: null,
  dueAt: null,
  scheduledFor: null,
  completedAt: null,
  originDocumentId: null,
  originInteractionId: null,
  sourceRecordType: null,
  sourceRecordId: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  archivedAt: null,
}

function deferredWrite() {
  let resolve: (value: number) => void = () => {}
  let reject: (cause: unknown) => void = () => {}
  const promise = new Promise<number>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function setup(
  write: (params: unknown[], args: Record<string, unknown>) => Promise<number> = () => Promise.resolve(1),
) {
  const writes = vi.fn(write)
  installFakeBridge({
    respond: (command, args) => command === 'db_execute' ? writes(args['params'] as unknown[], args) : undefined,
  })
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <StrictMode><QueryClientProvider client={client}>{children}</QueryClientProvider></StrictMode>
  }
  const hook = renderHook((value: TaskWithIdentity) => useTaskDraft(value), { initialProps: task, wrapper: Wrapper })
  return { ...hook, writes }
}

describe('task draft autosave', () => {
  it('coalesces edits made during a write and flushes the latest draft on unmount', async () => {
    const first = deferredWrite()
    const { result, writes, unmount } = setup(() => writes.mock.calls.length === 1 ? first.promise : Promise.resolve(1))

    act(() => {
      result.current.patchForm({ title: 'First edit' })
      void result.current.flush()
    })
    await waitFor(() => expect(writes).toHaveBeenCalledTimes(1))
    act(() => {
      result.current.patchForm({ title: 'Second edit' })
      void result.current.flush()
      result.current.patchForm({ title: 'Latest edit' })
    })
    expect(writes).toHaveBeenCalledTimes(1)
    unmount()
    expect(writes).toHaveBeenCalledTimes(1)

    await act(async () => first.resolve(1))
    await waitFor(() => expect(writes).toHaveBeenCalledTimes(2))
    expect(writes.mock.calls.map(([params]) => params[0])).toEqual(['First edit', 'Latest edit'])
  })

  it('persists a revert to the original value after the in-flight edit commits', async () => {
    const first = deferredWrite()
    const { result, writes } = setup(() => writes.mock.calls.length === 1 ? first.promise : Promise.resolve(1))

    act(() => {
      result.current.patchForm({ title: 'Temporary edit' })
      void result.current.flush()
    })
    await waitFor(() => expect(writes).toHaveBeenCalledTimes(1))
    act(() => result.current.patchForm({ title: task.title }))
    expect(result.current.saveState).toBe('saving')

    await act(async () => first.resolve(1))
    await waitFor(() => expect(result.current.saveState).toBe('idle'))
    expect(writes.mock.calls.map(([params]) => params[0])).toEqual(['Temporary edit', task.title])
  })

  it('preserves the draft and native error after failure, then retries on blur', async () => {
    const first = deferredWrite()
    const { result, writes } = setup(() => writes.mock.calls.length === 1 ? first.promise : Promise.resolve(1))

    act(() => {
      result.current.patchForm({ title: 'Keep this draft' })
      void result.current.flush()
    })
    await waitFor(() => expect(writes).toHaveBeenCalledTimes(1))
    await act(async () => first.reject({ kind: 'database', message: 'Database is busy' }))
    expect(result.current.form.title).toBe('Keep this draft')
    expect(result.current.error).toBe('Database is busy')
    expect(result.current.saveState).toBe('error')
    expect(writes).toHaveBeenCalledTimes(1)

    await act(async () => result.current.flush())
    expect(result.current.saveState).toBe('idle')
    expect(result.current.error).toBeNull()
    expect(writes).toHaveBeenCalledTimes(2)
  })

  it('keeps an invalid newer edit visible when an earlier valid write finishes', async () => {
    const first = deferredWrite()
    const { result, writes } = setup(() => first.promise)
    act(() => {
      result.current.patchForm({ title: 'Valid edit' })
      void result.current.flush()
    })
    await waitFor(() => expect(writes).toHaveBeenCalledTimes(1))
    act(() => result.current.patchForm({ title: '' }))
    await act(async () => first.resolve(1))

    expect(result.current.form.title).toBe('')
    expect(result.current.error).toBe('Title is required')
    expect(result.current.saveState).toBe('error')
    expect(writes).toHaveBeenCalledTimes(1)
  })

  it('pins an unmount flush to the original brain after the active brain changes', async () => {
    let activeGeneration = 1
    const persisted: unknown[][] = []
    const { result, writes, unmount } = setup((params, args) => {
      if (args['expectedGeneration'] !== activeGeneration) {
        return Promise.reject({ kind: 'stale', message: 'The active brain changed.' })
      }
      persisted.push(params)
      return Promise.resolve(1)
    })
    act(() => result.current.patchForm({ title: 'Old brain draft' }))
    activeGeneration = 2
    unmount()

    await waitFor(() => expect(writes).toHaveBeenCalledTimes(1))
    expect(writes.mock.calls[0]?.[1]).toMatchObject({
      expectedDatabasePath: '/original/brain.sqlite',
      expectedGeneration: 1,
    })
    expect(persisted).toEqual([])
  })

  it('keeps queued writes pinned when a brain switches during the first write', async () => {
    const first = deferredWrite()
    let activeGeneration = 1
    const persisted: unknown[][] = []
    const { result, writes, rerender } = setup((params, args) => {
      if (args['expectedGeneration'] !== activeGeneration) {
        return Promise.reject({ kind: 'stale', message: 'The active brain changed.' })
      }
      persisted.push(params)
      return first.promise
    })
    act(() => {
      result.current.patchForm({ title: 'First old brain edit' })
      void result.current.flush()
    })
    await waitFor(() => expect(writes).toHaveBeenCalledTimes(1))
    act(() => result.current.patchForm({ title: 'Queued old brain edit' }))
    activeGeneration = 2
    rerender({ ...task, databaseIdentity: { ...task.databaseIdentity, generation: 2 } })
    await act(async () => first.resolve(1))

    await waitFor(() => expect(result.current.saveState).toBe('error'))
    expect(result.current.error).toBe('The active brain changed.')
    expect(writes).toHaveBeenCalledTimes(2)
    expect(writes.mock.calls.map(([, args]) => args['expectedGeneration'])).toEqual([1, 1])
    expect(persisted.map((params) => params[0])).toEqual(['First old brain edit'])
  })

  it('adopts refreshed records only while the draft is clean', async () => {
    const { result, rerender, writes } = setup()
    rerender({ ...task, title: 'External update' })
    expect(result.current.form.title).toBe('External update')
    expect(writes).not.toHaveBeenCalled()

    act(() => result.current.patchForm({ title: 'Local draft' }))
    rerender({ ...task, title: 'Later external update' })
    expect(result.current.form.title).toBe('Local draft')
    await act(async () => result.current.flush())
    expect(writes.mock.calls[0]?.[0][0]).toBe('Local draft')
  })
})
