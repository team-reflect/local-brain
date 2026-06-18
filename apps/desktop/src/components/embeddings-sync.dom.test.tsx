// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type EmbedStatus, setBridge } from '@local-brain/core'
import { act, render, waitFor } from '@testing-library/react'
import { EmbeddingsSync } from './embeddings-sync'
import { EMBEDDINGS_STATUS_KEY, todayLocalDayKey } from '../lib/queries'

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

/** A bridge that reports `runtime` for the embedding commands, enabled + empty. */
function installStatusBridge(runtime: EmbedStatus): string[] {
  const commands: string[] = []
  setBridge({
    invoke: (command, args) => {
      commands.push(command)
      switch (command) {
        case 'embed_status':
        case 'embed_ensure':
          return Promise.resolve(runtime)
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
          if (/count/i.test(sql)) return Promise.resolve([{ count: 1 }]) // one chunk total
          if (sql.includes('from "chunk_embeddings"')) return Promise.resolve([]) // no orphans to prune
          return Promise.resolve([{ chunkId: 'c1', text: 'hello', storedHash: null }]) // pending
        }
        case 'db_execute': {
          const sql = String((args as { sql?: unknown }).sql ?? '')
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

function installPendingBackfillBridge(options: { lastDay?: string | null; failEmbed?: boolean } = {}) {
  const commands: string[] = []
  const events: string[] = []
  let persistedError: string | null = null
  let persistedDay: string | null = options.lastDay ?? null
  setBridge({
    invoke: (command, args) => {
      commands.push(command)
      const params = ((args as { params?: unknown[] }).params ?? []) as unknown[]
      switch (command) {
        case 'embed_status':
        case 'embed_ensure':
          return Promise.resolve({ status: 'ready', model: 'all-MiniLM-L6-v2' })
        case 'embed_texts':
          events.push('embed_texts')
          return options.failEmbed
            ? Promise.reject(new Error('onnx blew up'))
            : Promise.resolve(((args as { texts: string[] }).texts ?? []).map(() => [0.1, 0.2, 0.3]))
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
          if (/count/i.test(sql)) return Promise.resolve([{ count: 1 }])
          if (sql.includes('from "chunk_embeddings"')) return Promise.resolve([])
          return Promise.resolve([{ chunkId: 'c1', text: 'hello', storedHash: null }])
        }
        case 'db_execute': {
          const sql = String((args as { sql?: unknown }).sql ?? '')
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
  }
}

function renderSync() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <EmbeddingsSync />
    </QueryClientProvider>,
  )
}

describe('EmbeddingsSync', () => {
  afterEach(() => setBridge({ invoke: () => Promise.reject(new Error('no bridge')) }))

  it('ensures the runtime when it is uninitialized', async () => {
    const commands = installStatusBridge({ status: 'uninitialized' })
    renderSync()
    await waitFor(() => expect(commands).toContain('embed_ensure'))
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

  it('runs automatic backfill when pending and no backfill has run today', async () => {
    const bridge = installPendingBackfillBridge()
    renderSync()
    await waitFor(() => expect(bridge.commands).toContain('embed_texts'))
    expect(bridge.persistedDay()).toBe(todayLocalDayKey())
  })

  it('does not run automatic backfill when the daily cap was already used', async () => {
    const bridge = installPendingBackfillBridge({ lastDay: todayLocalDayKey() })
    renderSync()
    await waitFor(() => expect(bridge.commands).toContain('embed_status'))
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(bridge.commands).not.toContain('embed_texts')
  })

  it('records the daily cap marker before automatic embedding starts', async () => {
    const bridge = installPendingBackfillBridge()
    renderSync()
    await waitFor(() => expect(bridge.events).toContain('embed_texts'))
    expect(bridge.events.slice(0, 2)).toEqual(['set_last_day', 'embed_texts'])
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
            if (/count/i.test(sql)) return Promise.resolve([{ count: pending.length }])
            if (sql.includes('from "chunk_embeddings"')) return Promise.resolve([]) // no orphans to prune
            return Promise.resolve(pending) // pending chunks for the backfill
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
