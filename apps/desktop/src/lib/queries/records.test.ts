// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setBridge, type Task } from '@local-brain/core'
import { PALETTE_SEARCH_QUERY_KEY } from './search'
import { useCreateTask, useSetTaskCompleted } from './records'

const TASK: Task = {
  id: 'task-1',
  title: 'Send the proposal',
  description: null,
  status: 'open',
  priority: null,
  projectId: 'project-1',
  dueAt: '2026-07-14',
  scheduledFor: null,
  completedAt: null,
  originDocumentId: null,
  originInteractionId: null,
  sourceRecordType: null,
  sourceRecordId: null,
  createdAt: '2026-07-13T08:00:00.000Z',
  updatedAt: '2026-07-13T08:00:00.000Z',
  archivedAt: null,
}

afterEach(() => {
  setBridge(null)
})

describe('useSetTaskCompleted', () => {
  it('optimistically updates task views and restores every snapshot on failure', async () => {
    let rejectWrite: (reason: Error) => void = () => {}
    const write = new Promise<number>((_resolve, reject) => {
      rejectWrite = reject
    })
    setBridge({
      invoke: (command) =>
        command === 'db_execute' ? write : Promise.reject(new Error(`Unexpected command: ${command}`)),
    })

    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const openTasksKey = ['tasks', { status: 'open' }] as const
    const taskKey = ['task', TASK.id] as const
    const projectLinksKey = ['project', 'project-1', 'links'] as const
    const searchKey = [...PALETTE_SEARCH_QUERY_KEY, 'proposal'] as const
    queryClient.setQueryData(openTasksKey, [TASK])
    queryClient.setQueryData(taskKey, TASK)
    queryClient.setQueryData(projectLinksKey, {
      tasks: [
        {
          kind: 'task',
          id: TASK.id,
          title: TASK.title,
          subtitle: 'open',
          status: 'open',
          dueAt: TASK.dueAt,
          scheduledFor: null,
          priority: null,
        },
      ],
    })
    queryClient.setQueryData(searchKey, [
      { kind: 'task', id: TASK.id, title: TASK.title, subtitle: 'open', snippet: null, score: 1 },
    ])

    function Wrapper({ children }: { children: ReactNode }): ReactNode {
      return createElement(QueryClientProvider, { client: queryClient }, children)
    }

    const { result } = renderHook(() => useSetTaskCompleted(), { wrapper: Wrapper })
    act(() => result.current.mutate({ id: TASK.id, completed: true }))

    await waitFor(() => expect(result.current.isPending).toBe(true))
    expect(queryClient.getQueryData(openTasksKey)).toEqual([])
    expect(queryClient.getQueryData<Task>(taskKey)).toMatchObject({
      status: 'done',
      completedAt: expect.any(String),
    })
    expect(queryClient.getQueryData<{ tasks: Array<{ status: string; subtitle: string }> }>(projectLinksKey))
      .toMatchObject({ tasks: [{ status: 'done', subtitle: 'done' }] })
    expect(queryClient.getQueryData<Array<{ subtitle: string }>>(searchKey))
      .toMatchObject([{ subtitle: 'done' }])

    act(() => rejectWrite(new Error('write failed')))
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(queryClient.getQueryData(openTasksKey)).toEqual([TASK])
    expect(queryClient.getQueryData(taskKey)).toEqual(TASK)
    expect(queryClient.getQueryData<{ tasks: Array<{ status: string; subtitle: string }> }>(projectLinksKey))
      .toMatchObject({ tasks: [{ status: 'open', subtitle: 'open' }] })
    expect(queryClient.getQueryData<Array<{ subtitle: string }>>(searchKey))
      .toMatchObject([{ subtitle: 'open' }])
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['graph'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: PALETTE_SEARCH_QUERY_KEY })
    expect(invalidate.mock.calls.some(([filters]) => typeof filters?.predicate === 'function')).toBe(true)
  })
})

describe('useCreateTask', () => {
  it('refreshes task discovery and the selected project after creation', async () => {
    setBridge({
      invoke: (command) =>
        command === 'db_execute'
          ? Promise.resolve(1)
          : Promise.reject(new Error(`Unexpected command: ${command}`)),
    })
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    function Wrapper({ children }: { children: ReactNode }): ReactNode {
      return createElement(QueryClientProvider, { client: queryClient }, children)
    }

    const { result } = renderHook(() => useCreateTask(), { wrapper: Wrapper })
    let createdId = ''
    await act(async () => {
      createdId = await result.current.mutateAsync({
        title: 'Prepare launch brief',
        projectId: 'project-1',
      })
    })

    expect(createdId).toHaveLength(26)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['graph'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: PALETTE_SEARCH_QUERY_KEY })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['project', 'project-1', 'links'] })
  })
})
