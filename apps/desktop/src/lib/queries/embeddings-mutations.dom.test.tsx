// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type EmbedStatus, setBridge } from '@local-brain/core'
import { renderHook, waitFor } from '@testing-library/react'
import { EMBEDDINGS_STATUS_KEY } from './embeddings'
import {
  todayLocalDayKey,
  useBackfillEmbeddingsNow,
  useRebuildEmbeddings,
  useSetEmbeddingsEnabled,
} from './embeddings'

/**
 * Invalidate-on-settle contract (Bugbot pass 7 follow-up, "Failed mutations skip
 * invalidation"): `useRebuildEmbeddings` and `useSetEmbeddingsEnabled` persist
 * durable state (`embed_clear`, `setBackfillError`, `embeddings.enabled`) before
 * a step that can throw. An onSuccess-only refresh would leave the UI showing a
 * full/healthy index after a rebuild wipe that then failed until a later focus
 * refetch or slow poll. Both must invalidate the status query on *settle* so a
 * failed run still refreshes the cache immediately.
 */

/** A bridge whose runtime is `ready` with one pending chunk, but `embed_texts` fails. */
function installEmbeddingMutationBridge(
  ensure: EmbedStatus = { status: 'ready', model: 'm' },
  options: { failEmbed?: boolean } = { failEmbed: true },
) {
  const commands: string[] = []
  let persistedDay: string | null = null
  setBridge({
    invoke: (command, args) => {
      commands.push(command)
      const params = ((args as { params?: unknown[] }).params ?? []) as unknown[]
      switch (command) {
        case 'embed_database_identity':
          return Promise.resolve({ databasePath: '/test/brain.sqlite', generation: 1 })
        case 'embed_ensure':
          return Promise.resolve(ensure)
        case 'embed_clear':
        case 'embed_apply':
        case 'embed_delete':
          return Promise.resolve(0)
        case 'embed_texts':
          return options.failEmbed
            ? Promise.reject(new Error('onnx blew up'))
            : Promise.resolve(((args as { texts: string[] }).texts ?? []).map(() => []))
        case 'db_query': {
          const sql = String((args as { sql?: unknown }).sql ?? '')
          if (sql.includes('from "chunk_embeddings"')) return Promise.resolve([]) // no orphans
          if (sql.includes('"content_hash" is null')) return Promise.resolve([])
          if (!sql.includes('settings')) {
            return Promise.resolve([{ chunkId: 'c1', text: 'hello', storedHash: null }])
          }
          return Promise.resolve([])
        }
        case 'db_execute': {
          const sql = String((args as { sql?: unknown }).sql ?? '')
          if (sql.includes('settings') && params[0] === 'embeddings.lastBackfillAttemptDay') {
            persistedDay = JSON.parse(String(params[1])) as string | null
          }
          return Promise.resolve(1)
        }
        case 'db_batch':
          return Promise.resolve([])
        default:
          return Promise.resolve(params.length ? 0 : null)
      }
    },
  })
  return { commands, persistedDay: () => persistedDay }
}

function renderWithClient<T>(hook: () => T) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const rendered = renderHook(hook, { wrapper })
  return { ...rendered, invalidate }
}

describe('embedding mutation invalidation', () => {
  afterEach(() => setBridge({ invoke: () => Promise.reject(new Error('no bridge')) }))

  it('invalidates the status query when a rebuild fails mid-pass', async () => {
    installEmbeddingMutationBridge()
    const { result, invalidate } = renderWithClient(() => useRebuildEmbeddings())

    result.current.mutate()

    // The rebuild throws inside the backfill, but the wipe already landed — the
    // cache must still be invalidated so the UI reflects the empty/error state.
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: EMBEDDINGS_STATUS_KEY })
  })

  it('manual backfill invalidates status, records today, and does not clear vectors', async () => {
    const bridge = installEmbeddingMutationBridge(
      { status: 'ready', model: 'm' },
      { failEmbed: false },
    )
    const { result, invalidate } = renderWithClient(() => useBackfillEmbeddingsNow())

    result.current.mutate()

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(bridge.commands).toContain('embed_texts')
    expect(bridge.commands).not.toContain('embed_clear')
    expect(bridge.persistedDay()).toBe(todayLocalDayKey())
    expect(invalidate).toHaveBeenCalledWith({ queryKey: EMBEDDINGS_STATUS_KEY })
  })

  it('invalidates the status query when enabling fails after persisting state', async () => {
    // `setEmbeddingsEnabled` + recovery markers commit before `embed_ensure`
    // rejects, so a failed enable still changed the DB and must refresh the cache.
    let persistedDay: string | null | undefined
    setBridge({
      invoke: (command, args) => {
        const params = ((args as { params?: unknown[] }).params ?? []) as unknown[]
        switch (command) {
          case 'embed_database_identity':
            return Promise.resolve({ databasePath: '/test/brain.sqlite', generation: 1 })
          case 'embed_ensure':
            return Promise.reject(new Error('load failed'))
          case 'db_execute': {
            const sql = String((args as { sql?: unknown }).sql ?? '')
            if (sql.includes('settings') && params[0] === 'embeddings.lastBackfillAttemptDay') {
              persistedDay = JSON.parse(String(params[1])) as string | null
            }
            return Promise.resolve(1)
          }
          default:
            return Promise.resolve(null)
        }
      },
    })
    const { result, invalidate } = renderWithClient(() => useSetEmbeddingsEnabled())

    result.current.mutate(true)

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(persistedDay).toBeNull()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: EMBEDDINGS_STATUS_KEY })
  })
})
