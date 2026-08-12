// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  type BrainInfo,
  type EmbeddingsStatus,
  type EmbedStatus,
  setBridge,
} from '@local-brain/core'
import { act, render, waitFor } from '@testing-library/react'
import { EmbeddingsSync } from './embeddings-sync'
import {
  EMBEDDINGS_CATCH_UP_REFETCH_MS,
  EMBEDDINGS_STATUS_KEY,
  todayLocalDayKey,
} from '../lib/queries'
import { ACTIVE_BRAIN_KEY } from '../lib/queries/brains'

/**
 * Auto-load policy (Bugbot #27 follow-up): `EmbeddingsSync` brings the runtime up
 * from `uninitialized`, but a `failed` runtime must NOT be retried on every poll —
 * a permanent load error would otherwise re-trigger the full download/load every
 * 1.5s. Recovery is user-driven (re-enable / Rebuild index), not automatic.
 *
 * Backfill-failure policy (Bugbot "Backfill errors swallowed silently"): when the
 * incremental backfill throws, the coordinator must persist the error rather than
 * swallow it, so the status/UI stop pretending indexing is progressing and the
 * same failing backfill is not re-attempted on every poll.
 */

function isCountQuery(sql: string): boolean {
  return /select count\(\*\)/i.test(sql)
}

function isTotalChunkCountQuery(sql: string): boolean {
  return (
    isCountQuery(sql) &&
    sql.includes('from "content_chunks"') &&
    !sql.includes('from "content_chunks" as "cc"')
  )
}

function isPendingChunkCountQuery(sql: string): boolean {
  return isCountQuery(sql) && sql.includes('from "content_chunks" as "cc"')
}

function isOrphanEmbeddingCountQuery(sql: string): boolean {
  return isCountQuery(sql) && sql.includes('from "chunk_embeddings" as "ce"')
}

function isOrphanEmbeddingRowsQuery(sql: string): boolean {
  return !isCountQuery(sql) && sql.includes('from "chunk_embeddings" as "ce"')
}

function isPendingChunkRowsQuery(sql: string): boolean {
  return !isCountQuery(sql) && sql.includes('from "content_chunks" as "cc"')
}

/** A bridge that reports `runtime` for the embedding commands, enabled + empty. */
function installStatusBridge(
  runtime: EmbedStatus,
  options: { failEnsure?: boolean } = {},
): string[] {
  const commands: string[] = []
  setBridge({
    invoke: (command, args) => {
      commands.push(command)
      switch (command) {
        case 'embed_database_identity':
          return Promise.resolve({ databasePath: '/test/brain.sqlite', generation: 1 })
        case 'embed_status':
          return Promise.resolve(runtime)
        case 'embed_ensure':
          return options.failEnsure
            ? Promise.reject(new Error('runtime load failed'))
            : Promise.resolve(runtime)
        case 'db_query': {
          const sql = String((args as { sql?: unknown }).sql ?? '')
          const params = ((args as { params?: unknown[] }).params ?? []) as unknown[]
          if (sql.includes('settings')) {
            const key = params[0]
            if (key === 'embeddings.enabled') return Promise.resolve([{ valueJson: 'true' }])
            return Promise.resolve([])
          }
          if (/count/i.test(sql)) return Promise.resolve([{ count: 0 }]) // no chunks
          return Promise.resolve([]) // no pending chunks
        }
        default:
          return Promise.resolve(null)
      }
    },
  })
  return commands
}

/**
 * A bridge whose runtime is `ready` with one pending chunk, but whose `embed_texts`
 * rejects — i.e. the incremental backfill fails. Tracks commands and captures the
 * value written to the `embeddings.backfillError` setting via `db_execute`.
 */
function installFailingBackfillBridge() {
  const commands: string[] = []
  let persistedError: string | null = null
  let persistedDay: string | null = null
  setBridge({
    invoke: (command, args) => {
      commands.push(command)
      const params = ((args as { params?: unknown[] }).params ?? []) as unknown[]
      switch (command) {
        case 'embed_database_identity':
          return Promise.resolve({ databasePath: '/test/brain.sqlite', generation: 1 })
        case 'embed_status':
        case 'embed_ensure':
          return Promise.resolve({ status: 'ready', model: 'all-MiniLM-L6-v2' })
        case 'embed_texts':
          return Promise.reject(new Error('onnx blew up'))
        case 'db_query': {
          const sql = String((args as { sql?: unknown }).sql ?? '')
          if (sql.includes('settings')) {
            const key = params[0]
            if (key === 'embeddings.enabled') return Promise.resolve([{ valueJson: 'true' }])
            if (key === 'embeddings.lastBackfillAttemptDay') {
              return Promise.resolve(
                persistedDay === null ? [] : [{ valueJson: JSON.stringify(persistedDay) }],
              )
            }
            // The sticky backfill-error read drives the poll/retry gate.
            return Promise.resolve(
              persistedError === null ? [] : [{ valueJson: JSON.stringify(persistedError) }],
            )
          }
          if (isTotalChunkCountQuery(sql)) return Promise.resolve([{ count: 1 }])
          if (isPendingChunkCountQuery(sql)) return Promise.resolve([{ count: 1 }])
          if (isOrphanEmbeddingCountQuery(sql)) return Promise.resolve([{ count: 0 }])
          if (isOrphanEmbeddingRowsQuery(sql)) return Promise.resolve([])
          if (isPendingChunkRowsQuery(sql)) {
            return Promise.resolve([{ chunkId: 'c1', text: 'hello', storedHash: null }])
          }
          return Promise.resolve([])
        }
        case 'db_execute': {
          const sql = String((args as { sql?: unknown }).sql ?? '')
          if (sql.includes('settings')) {
            expect(args).toMatchObject({
              expectedDatabasePath: '/test/brain.sqlite',
              expectedGeneration: 1,
            })
          }
          // setSetting compiles to INSERT ... settings (key, value_json, updated_at).
          if (sql.includes('settings') && params[0] === 'embeddings.backfillError') {
            persistedError = JSON.parse(String(params[1])) as string | null
          }
          if (sql.includes('settings') && params[0] === 'embeddings.lastBackfillAttemptDay') {
            persistedDay = JSON.parse(String(params[1])) as string | null
          }
          return Promise.resolve(1)
        }
        case 'db_batch':
          return Promise.resolve([])
        default:
          return Promise.resolve(null)
      }
    },
  })
  return {
    commands,
    persistedError: () => persistedError,
    persistedDay: () => persistedDay,
  }
}

function installPendingBackfillBridge(
  options: {
    lastDay?: string | null
    failEmbed?: boolean
    failIdentityAttempts?: number
    failSettingsWrite?: boolean
    pendingInitially?: boolean
    keepPendingAfterApply?: boolean
    embedTexts?: (texts: string[]) => Promise<number[][]>
  } = {},
) {
  const commands: string[] = []
  const events: string[] = []
  let persistedError: string | null = null
  let persistedDay: string | null = options.lastDay ?? null
  let pending = options.pendingInitially ?? true
  let identityFailuresRemaining = options.failIdentityAttempts ?? 0
  setBridge({
    invoke: (command, args) => {
      commands.push(command)
      const params = ((args as { params?: unknown[] }).params ?? []) as unknown[]
      switch (command) {
        case 'embed_database_identity':
          if (identityFailuresRemaining > 0) {
            identityFailuresRemaining -= 1
            return Promise.reject(new Error('identity unavailable'))
          }
          return Promise.resolve({ databasePath: '/test/brain.sqlite', generation: 1 })
        case 'embed_status':
        case 'embed_ensure':
          return Promise.resolve({ status: 'ready', model: 'all-MiniLM-L6-v2' })
        case 'embed_texts':
          events.push('embed_texts')
          if (options.embedTexts) {
            return options.embedTexts((args as { texts: string[] }).texts ?? [])
          }
          return options.failEmbed
            ? Promise.reject(new Error('onnx blew up'))
            : Promise.resolve(((args as { texts: string[] }).texts ?? []).map(() => [0.1, 0.2, 0.3]))
        case 'embed_apply':
          if (!options.keepPendingAfterApply) pending = false
          return Promise.resolve(1)
        case 'db_query': {
          const sql = String((args as { sql?: unknown }).sql ?? '')
          if (sql.includes('settings')) {
            const key = params[0]
            if (key === 'embeddings.enabled') return Promise.resolve([{ valueJson: 'true' }])
            if (key === 'embeddings.backfillError') {
              return Promise.resolve(
                persistedError === null ? [] : [{ valueJson: JSON.stringify(persistedError) }],
              )
            }
            if (key === 'embeddings.lastBackfillAttemptDay') {
              return Promise.resolve(
                persistedDay === null ? [] : [{ valueJson: JSON.stringify(persistedDay) }],
              )
            }
            return Promise.resolve([])
          }
          if (isTotalChunkCountQuery(sql)) return Promise.resolve([{ count: 1 }])
          if (isPendingChunkCountQuery(sql)) {
            return Promise.resolve([{ count: pending ? 1 : 0 }])
          }
          if (isOrphanEmbeddingCountQuery(sql)) return Promise.resolve([{ count: 0 }])
          if (isOrphanEmbeddingRowsQuery(sql)) return Promise.resolve([])
          if (isPendingChunkRowsQuery(sql)) {
            return Promise.resolve(
              pending ? [{ chunkId: 'c1', text: 'hello', storedHash: null }] : [],
            )
          }
          return Promise.resolve([])
        }
        case 'db_execute': {
          const sql = String((args as { sql?: unknown }).sql ?? '')
          if (sql.includes('settings')) {
            expect(args).toMatchObject({
              expectedDatabasePath: '/test/brain.sqlite',
              expectedGeneration: 1,
            })
            if (options.failSettingsWrite) {
              return Promise.reject(new Error('settings are read-only'))
            }
          }
          if (sql.includes('settings') && params[0] === 'embeddings.backfillError') {
            persistedError = JSON.parse(String(params[1])) as string | null
          }
          if (sql.includes('settings') && params[0] === 'embeddings.lastBackfillAttemptDay') {
            events.push('set_last_day')
            persistedDay = JSON.parse(String(params[1])) as string | null
          }
          return Promise.resolve(1)
        }
        case 'db_batch':
          return Promise.resolve([])
        default:
          return Promise.resolve(null)
      }
    },
  })
  return {
    commands,
    events,
    persistedError: () => persistedError,
    persistedDay: () => persistedDay,
    setPending: (value: boolean) => {
      pending = value
    },
  }
}

function installOrphanPruneBridge() {
  const commands: string[] = []
  const orphanCountResults: number[] = []
  let orphaned = true
  let maintenanceRuns = 0
  let persistedError: string | null = null
  let persistedDay: string | null = null

  setBridge({
    invoke: (command, args) => {
      commands.push(command)
      const params = ((args as { params?: unknown[] }).params ?? []) as unknown[]
      switch (command) {
        case 'embed_database_identity':
          return Promise.resolve({ databasePath: '/test/brain.sqlite', generation: 1 })
        case 'embed_status':
        case 'embed_ensure':
          return Promise.resolve({ status: 'ready', model: 'all-MiniLM-L6-v2' })
        case 'embed_delete':
          expect(args).toMatchObject({
            expectedDatabasePath: '/test/brain.sqlite',
            expectedGeneration: 1,
            chunkIds: ['orphan-chunk'],
          })
          orphaned = false
          return Promise.resolve(1)
        case 'embed_texts':
          return Promise.resolve([])
        case 'db_query': {
          const sql = String((args as { sql?: unknown }).sql ?? '')
          if (sql.includes('settings')) {
            const key = params[0]
            if (key === 'embeddings.enabled') return Promise.resolve([{ valueJson: 'true' }])
            if (key === 'embeddings.backfillError') {
              return Promise.resolve(
                persistedError === null ? [] : [{ valueJson: JSON.stringify(persistedError) }],
              )
            }
            if (key === 'embeddings.lastBackfillAttemptDay') {
              return Promise.resolve(
                persistedDay === null ? [] : [{ valueJson: JSON.stringify(persistedDay) }],
              )
            }
            return Promise.resolve([])
          }
          if (isTotalChunkCountQuery(sql)) return Promise.resolve([{ count: 1 }])
          if (isPendingChunkCountQuery(sql)) return Promise.resolve([{ count: 0 }])
          if (isOrphanEmbeddingCountQuery(sql)) {
            const count = orphaned ? 1 : 0
            orphanCountResults.push(count)
            return Promise.resolve([{ count }])
          }
          if (isOrphanEmbeddingRowsQuery(sql)) {
            return Promise.resolve(orphaned ? [{ chunkId: 'orphan-chunk' }] : [])
          }
          return Promise.resolve([])
        }
        case 'db_execute': {
          const sql = String((args as { sql?: unknown }).sql ?? '')
          if (sql.includes('settings')) {
            expect(args).toMatchObject({
              expectedDatabasePath: '/test/brain.sqlite',
              expectedGeneration: 1,
            })
          }
          if (sql.includes('settings') && params[0] === 'embeddings.backfillError') {
            persistedError = JSON.parse(String(params[1])) as string | null
          }
          if (sql.includes('settings') && params[0] === 'embeddings.lastBackfillAttemptDay') {
            maintenanceRuns += 1
            persistedDay = JSON.parse(String(params[1])) as string | null
          }
          return Promise.resolve(1)
        }
        case 'db_batch':
          return Promise.resolve([])
        default:
          return Promise.resolve(null)
      }
    },
  })

  return {
    commands,
    orphanCountResults,
    maintenanceRuns: () => maintenanceRuns,
  }
}

function renderSync(
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
) {
  return render(
    <QueryClientProvider client={client}>
      <EmbeddingsSync />
    </QueryClientProvider>,
  )
}

function brain(databasePath: string): BrainInfo {
  return {
    rootPath: databasePath.replace(/\/brain\.sqlite$/, ''),
    databasePath,
    assetsPath: `${databasePath}.assets`,
    name: 'Test brain',
    color: 'blue',
    createdMs: 0,
    lastOpenedMs: 0,
    isActive: true,
    schemaVersion: 1,
  }
}

describe('EmbeddingsSync', () => {
  afterEach(() => setBridge({ invoke: () => Promise.reject(new Error('no bridge')) }))

  it('ensures the runtime when it is uninitialized', async () => {
    const commands = installStatusBridge({ status: 'uninitialized' })
    renderSync()
    await waitFor(() => expect(commands).toContain('embed_ensure'))
  })

  it('handles a rejected automatic ensure once without an unhandled retry loop', async () => {
    const commands = installStatusBridge({ status: 'uninitialized' }, { failEnsure: true })
    renderSync()

    await waitFor(() => expect(commands.filter((command) => command === 'embed_ensure')).toHaveLength(1))
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
    expect(commands.filter((command) => command === 'embed_ensure')).toHaveLength(1)
  })

  it('does not auto-retry ensure when the runtime has failed', async () => {
    const commands = installStatusBridge({ status: 'failed', message: 'onnx blew up' })
    renderSync()
    // Wait until the status query has resolved and the effect has had a chance to run.
    await waitFor(() => expect(commands).toContain('embed_status'))
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(commands).not.toContain('embed_ensure')
  })

  it('persists a backfill failure instead of swallowing it, and stops retrying', async () => {
    const bridge = installFailingBackfillBridge()
    renderSync()

    // The runtime is ready with a pending chunk, so the coordinator attempts a
    // backfill — which fails inside `embed_texts`.
    await waitFor(() => expect(bridge.commands).toContain('embed_texts'))

    // The error must be persisted (surfaced) rather than swallowed.
    await waitFor(() => expect(bridge.persistedError()).toBe('onnx blew up'))
    expect(bridge.persistedDay()).toBe(todayLocalDayKey())

    // And, like the failed runtime, the failing backfill must not be re-attempted
    // on every poll: once the error is sticky, no further `embed_texts` calls fire.
    const attempts = bridge.commands.filter((c) => c === 'embed_texts').length
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
    expect(bridge.commands.filter((c) => c === 'embed_texts').length).toBe(attempts)
  })

  it('runs automatic backfill when pending', async () => {
    const bridge = installPendingBackfillBridge()
    renderSync()
    await waitFor(() => expect(bridge.commands).toContain('embed_texts'))
    expect(bridge.persistedDay()).toBe(todayLocalDayKey())
  })

  it('prunes orphan embeddings when no chunks are pending and settles ready', async () => {
    const bridge = installOrphanPruneBridge()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    renderSync(client)

    await waitFor(() => {
      expect(bridge.commands.filter((command) => command === 'embed_delete')).toHaveLength(1)
    })
    await waitFor(() => {
      expect(client.getQueryData<EmbeddingsStatus>(EMBEDDINGS_STATUS_KEY)).toMatchObject({
        pending: 0,
        orphaned: 0,
        ready: true,
      })
    })

    expect(bridge.orphanCountResults).toContain(1)
    expect(bridge.orphanCountResults.at(-1)).toBe(0)
    expect(bridge.maintenanceRuns()).toBe(1)
    expect(bridge.commands).not.toContain('embed_texts')

    // Wait beyond the coordinator's success cooldown: the settled zero-orphan
    // status must cancel the scheduled retry rather than start a second pass.
    await act(() => new Promise((resolve) => setTimeout(resolve, 1_100)))
    expect(bridge.commands.filter((command) => command === 'embed_delete')).toHaveLength(1)
    expect(bridge.maintenanceRuns()).toBe(1)
  })

  it('retries a rejected identity capture on the slow catch-up cadence without hot-looping', async () => {
    vi.useFakeTimers()
    const bridge = installPendingBackfillBridge({ failIdentityAttempts: 1 })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    const view = renderSync(client)

    try {
      await vi.waitFor(() => {
        expect(bridge.commands.filter((command) => command === 'embed_database_identity')).toHaveLength(1)
      })
      await act(() => vi.advanceTimersByTimeAsync(5_000))
      expect(bridge.commands.filter((command) => command === 'embed_database_identity')).toHaveLength(1)
      expect(bridge.commands).not.toContain('embed_texts')

      // The outer failure is not persisted without an identity, but it also
      // does not permanently block catch-up. The coordinator retries only at
      // the same low frequency as the durable status heartbeat.
      await act(() =>
        vi.advanceTimersByTimeAsync(EMBEDDINGS_CATCH_UP_REFETCH_MS - 5_000),
      )
      await vi.waitFor(() => expect(bridge.commands).toContain('embed_texts'))
      expect(bridge.commands.filter((command) => command === 'embed_database_identity').length).toBeGreaterThan(1)
    } finally {
      view.unmount()
      vi.useRealTimers()
    }
  })

  it('handles rejected backfill settings writes without immediately retrying', async () => {
    const bridge = installPendingBackfillBridge({ failSettingsWrite: true })
    renderSync()

    await waitFor(() => {
      expect(bridge.commands.filter((command) => command === 'db_execute')).toHaveLength(2)
    })
    const attempts = bridge.commands.filter((command) => command === 'db_execute').length
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
    expect(bridge.commands.filter((command) => command === 'db_execute')).toHaveLength(attempts)
    expect(bridge.commands).not.toContain('embed_texts')
  })

  it('catches up new pending chunks even when a backfill already ran today', async () => {
    const bridge = installPendingBackfillBridge({ lastDay: todayLocalDayKey() })
    renderSync()
    await waitFor(() => expect(bridge.commands).toContain('embed_texts'))
  })

  it('catches up immediately after a successful in-app mutation', async () => {
    const bridge = installPendingBackfillBridge({ pendingInitially: false })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    render(
      <QueryClientProvider client={client}>
        <EmbeddingsSync />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(bridge.commands).toContain('embed_status'))
    expect(bridge.commands).not.toContain('embed_texts')

    const mutation = client.getMutationCache().build(client, {
      mutationFn: async () => {
        bridge.setPending(true)
      },
    })
    await mutation.execute(undefined)

    await waitFor(() => expect(bridge.commands).toContain('embed_texts'))
  })

  it('records the last-attempt marker before automatic embedding starts', async () => {
    const bridge = installPendingBackfillBridge()
    renderSync()
    await waitFor(() => expect(bridge.events).toContain('embed_texts'))
    expect(bridge.events.slice(0, 2)).toEqual(['set_last_day', 'embed_texts'])
  })

  it('throttles repeated successful passes while content keeps changing', async () => {
    const bridge = installPendingBackfillBridge({ keepPendingAfterApply: true })
    renderSync()
    await waitFor(() => expect(bridge.commands).toContain('embed_texts'))

    const attempts = bridge.commands.filter((command) => command === 'embed_texts').length
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
    expect(bridge.commands.filter((command) => command === 'embed_texts')).toHaveLength(attempts)
  })

  it('does not apply an in-flight batch after the coordinator unmounts', async () => {
    const retryTimerSpy = vi.spyOn(window, 'setTimeout')
    let finishEmbedding: (() => void) | null = null
    const bridge = installPendingBackfillBridge({
      embedTexts: (texts) =>
        new Promise((resolve) => {
          finishEmbedding = () => resolve(texts.map(() => [0.1, 0.2, 0.3]))
        }),
    })
    const rendered = renderSync()
    await waitFor(() => expect(bridge.commands).toContain('embed_texts'))

    rendered.unmount()
    retryTimerSpy.mockClear()
    await act(async () => {
      finishEmbedding?.()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(bridge.commands).not.toContain('embed_apply')
    expect(retryTimerSpy).not.toHaveBeenCalled()
    retryTimerSpy.mockRestore()
  })

  it('does not apply an in-flight batch after the active brain path changes', async () => {
    let finishEmbedding: (() => void) | null = null
    const bridge = installPendingBackfillBridge({
      embedTexts: (texts) =>
        new Promise((resolve) => {
          finishEmbedding = () => resolve(texts.map(() => [0.1, 0.2, 0.3]))
        }),
    })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
    })
    client.setQueryData(ACTIVE_BRAIN_KEY, brain('/test/brain.sqlite'))
    renderSync(client)
    await waitFor(() => expect(bridge.commands).toContain('embed_texts'))

    client.setQueryData(ACTIVE_BRAIN_KEY, brain('/test/other-brain.sqlite'))
    await act(async () => {
      finishEmbedding?.()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(bridge.commands).not.toContain('embed_apply')
  })

  it('aborts an in-flight backfill when semantic search is disabled mid-pass', async () => {
    // Disabling semantic search must abort the incremental backfill between
    // batches, not just on the next render. The coordinator observes the LIVE
    // enabled flag from the query cache, so flipping the cache mid-run aborts the
    // pass — a captured render snapshot would let it run to completion.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    const embedTextBatches: number[] = []
    let enabled = true
    // 40 pending chunks => two batches (EMBED_BATCH = 32, then 8).
    const pending = Array.from({ length: 40 }, (_, i) => ({
      chunkId: `c${i}`,
      text: `chunk ${i}`,
      storedHash: null,
    }))

    setBridge({
      invoke: (command, args) => {
        const params = ((args as { params?: unknown[] }).params ?? []) as unknown[]
        switch (command) {
          case 'embed_database_identity':
            return Promise.resolve({ databasePath: '/test/brain.sqlite', generation: 1 })
          case 'embed_status':
          case 'embed_ensure':
            return Promise.resolve({ status: 'ready', model: 'all-MiniLM-L6-v2' })
          case 'embed_texts': {
            const texts = (args as { texts: string[] }).texts
            embedTextBatches.push(texts.length)
            // The first batch is now embedding; disable semantic search so the
            // NEXT between-batch `isStale` check aborts. Flip both the live cache
            // (drives `isStale`) and the bridge setting (so the post-abort refetch
            // keeps it disabled and the coordinator doesn't restart the pass).
            enabled = false
            client.setQueryData(EMBEDDINGS_STATUS_KEY, (old) =>
              old ? { ...(old as object), enabled: false } : old,
            )
            return Promise.resolve(texts.map(() => [0.1, 0.2, 0.3]))
          }
          case 'db_query': {
            const sql = String((args as { sql?: unknown }).sql ?? '')
            if (sql.includes('settings')) {
              const key = params[0]
              if (key === 'embeddings.enabled') {
                return Promise.resolve([{ valueJson: JSON.stringify(enabled) }])
              }
              return Promise.resolve([]) // no sticky backfill error
            }
            if (isTotalChunkCountQuery(sql)) {
              return Promise.resolve([{ count: pending.length }])
            }
            if (isPendingChunkCountQuery(sql)) {
              return Promise.resolve([{ count: pending.length }])
            }
            if (isOrphanEmbeddingCountQuery(sql)) return Promise.resolve([{ count: 0 }])
            if (isOrphanEmbeddingRowsQuery(sql)) return Promise.resolve([])
            if (isPendingChunkRowsQuery(sql)) return Promise.resolve(pending)
            return Promise.resolve([])
          }
          case 'db_execute':
            return Promise.resolve(1)
          case 'db_batch':
            return Promise.resolve([])
          default:
            return Promise.resolve(null)
        }
      },
    })

    render(
      <QueryClientProvider client={client}>
        <EmbeddingsSync />
      </QueryClientProvider>,
    )

    // The first batch embeds, then the disable aborts before the second batch.
    await waitFor(() => expect(embedTextBatches.length).toBeGreaterThan(0))
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
    // Exactly one batch ran: the remaining pending chunks were never embedded.
    expect(embedTextBatches).toEqual([32])
  })
})
