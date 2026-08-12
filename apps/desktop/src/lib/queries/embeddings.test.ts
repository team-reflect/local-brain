import { afterEach, describe, expect, it } from 'vitest'
import { type EmbeddingsStatus, type EmbedStatus, setBridge } from '@local-brain/core'
import { runExclusiveBackfill } from '../embeddings-coordinator'
import {
  backfillEmbeddingsNow,
  embeddingsRefetchInterval,
  rebuildEmbeddings,
  todayLocalDayKey,
  withBackfillActive,
} from './embeddings'

/**
 * Rebuild safety contract (Bugbot #27 high-severity fix): the rebuild must never
 * clear the existing vector projection unless `embed_ensure` reports the runtime
 * is actually `ready`. A `loading` (concurrent load) or `failed` result must
 * abort *before* `embed_clear`, so a model that can't load can't wipe the index.
 *
 * Backfill-failure contract (Bugbot "Backfill errors swallowed silently"): a
 * rebuild that throws inside the backfill must persist the error to the
 * `embeddings.backfillError` setting so the UI keeps reporting the failure.
 */

interface BridgeHandle {
  commands: string[]
  /** The value last written to the `embeddings.backfillError` setting. */
  persistedError: () => string | null
  /** The value last written to the `embeddings.lastBackfillAttemptDay` setting. */
  persistedDay: () => string | null
}

function installBridge(
  ensure: EmbedStatus,
  options: { pendingChunk?: boolean; failEmbed?: boolean } = {},
): BridgeHandle {
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
        case 'embed_ensure':
          return Promise.resolve(ensure)
        case 'embed_clear':
        case 'embed_apply':
        case 'embed_delete':
          return Promise.resolve(0)
        case 'embed_texts':
          return options.failEmbed
            ? Promise.reject(new Error('onnx blew up'))
            : Promise.resolve((params[0] as { texts?: string[] })?.texts?.map(() => []) ?? [])
        // backfill's prune + pending scans read the content set here.
        case 'db_query': {
          const sql = String((args as { sql?: unknown }).sql ?? '')
          if (sql.includes('from "chunk_embeddings"')) return Promise.resolve([]) // no orphans
          if (options.pendingChunk && !sql.includes('settings')) {
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
  return { commands, persistedError: () => persistedError, persistedDay: () => persistedDay }
}

/**
 * Polling-cadence contract: the status query fast-polls active work and keeps a
 * cheap steady-state discovery poll for writes made by the CLI or another
 * process that cannot invalidate this renderer's React Query cache.
 */
function status(overrides: Partial<EmbeddingsStatus> = {}): EmbeddingsStatus {
  return {
    enabled: true,
    runtime: { status: 'ready', model: 'all-MiniLM-L6-v2' },
    modelId: 'all-MiniLM-L6-v2',
    indexed: 10,
    totalChunks: 10,
    pending: 0,
    orphaned: 0,
    ready: true,
    backfillError: null,
    lastBackfillAttemptDay: null,
    ...overrides,
  }
}

describe('embeddingsRefetchInterval', () => {
  it('does not poll before data loads or when disabled', () => {
    expect(embeddingsRefetchInterval(undefined)).toBe(false)
    expect(embeddingsRefetchInterval(status({ enabled: false }))).toBe(false)
  })

  it('fast-polls while the model loads', () => {
    expect(embeddingsRefetchInterval(status({ runtime: { status: 'loading' } }))).toBe(1500)
  })

  it('keeps a periodic catch-up poll after an automatic attempt', () => {
    expect(embeddingsRefetchInterval(status())).toBe(60_000)
    expect(embeddingsRefetchInterval(status({ pending: 4, ready: false }))).toBe(60_000)
    expect(embeddingsRefetchInterval(status({ orphaned: 1, ready: false }))).toBe(60_000)
    expect(embeddingsRefetchInterval(status({ lastBackfillAttemptDay: todayLocalDayKey() }))).toBe(60_000)
    expect(
      embeddingsRefetchInterval(
        status({ pending: 4, ready: false, lastBackfillAttemptDay: todayLocalDayKey() }),
      ),
    ).toBe(60_000)
  })

  it('fast-polls while a backfill is actively running', async () => {
    let release: () => void = () => {}
    const active = withBackfillActive(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )

    expect(
      embeddingsRefetchInterval(
        status({ pending: 4, ready: false, lastBackfillAttemptDay: todayLocalDayKey() }),
      ),
    ).toBe(1500)

    release()
    await active
    expect(
      embeddingsRefetchInterval(
        status({ pending: 4, ready: false, lastBackfillAttemptDay: todayLocalDayKey() }),
      ),
    ).toBe(60_000)
  })

  it('stops polling a failed runtime or a sticky backfill error', () => {
    expect(
      embeddingsRefetchInterval(status({ runtime: { status: 'failed', message: 'boom' } })),
    ).toBe(false)
    expect(embeddingsRefetchInterval(status({ backfillError: 'onnx blew up' }))).toBe(false)
    // Even with chunks pending, a sticky error must not resume the retry loop.
    expect(embeddingsRefetchInterval(status({ pending: 3, backfillError: 'onnx blew up' }))).toBe(
      false,
    )
  })
})

describe('backfillEmbeddingsNow', () => {
  afterEach(() => setBridge({ invoke: () => Promise.reject(new Error('no bridge')) }))

  it('runs a non-destructive backfill and records today', async () => {
    const bridge = installBridge(
      { status: 'ready', model: 'all-MiniLM-L6-v2' },
      { pendingChunk: true },
    )
    await expect(backfillEmbeddingsNow()).resolves.toBeUndefined()
    expect(bridge.commands).toContain('embed_ensure')
    expect(bridge.commands).toContain('embed_texts')
    expect(bridge.commands).not.toContain('embed_clear')
    expect(bridge.persistedDay()).toBe(todayLocalDayKey())
  })

  it('persists the backfill error when manual backfill fails', async () => {
    const bridge = installBridge(
      { status: 'ready', model: 'all-MiniLM-L6-v2' },
      { pendingChunk: true, failEmbed: true },
    )
    await expect(backfillEmbeddingsNow()).rejects.toThrow(/onnx blew up/)
    expect(bridge.commands).not.toContain('embed_clear')
    expect(bridge.persistedDay()).toBe(todayLocalDayKey())
    expect(bridge.persistedError()).toBe('onnx blew up')
  })
})

describe('rebuildEmbeddings', () => {
  afterEach(() => setBridge({ invoke: () => Promise.reject(new Error('no bridge')) }))

  it('clears and backfills when the runtime is ready', async () => {
    const { commands } = installBridge({ status: 'ready', model: 'all-MiniLM-L6-v2' })
    await expect(rebuildEmbeddings()).resolves.toBeUndefined()
    expect(commands).toContain('embed_ensure')
    expect(commands).toContain('embed_clear')
  })

  it('persists the backfill error when a ready-runtime rebuild fails mid-pass', async () => {
    const bridge = installBridge(
      { status: 'ready', model: 'all-MiniLM-L6-v2' },
      { pendingChunk: true, failEmbed: true },
    )
    await expect(rebuildEmbeddings()).rejects.toThrow(/onnx blew up/)
    // The failure is surfaced, not swallowed: the UI reads this from the status.
    expect(bridge.persistedError()).toBe('onnx blew up')
  })

  it('does not clear when ensure resolves still loading', async () => {
    const { commands } = installBridge({ status: 'loading' })
    await expect(rebuildEmbeddings()).rejects.toThrow(/still loading/)
    expect(commands).toContain('embed_ensure')
    expect(commands).not.toContain('embed_clear')
  })

  it('does not clear when the model failed to load', async () => {
    const { commands } = installBridge({ status: 'failed', message: 'onnx blew up' })
    await expect(rebuildEmbeddings()).rejects.toThrow(/failed to load: onnx blew up/)
    expect(commands).not.toContain('embed_clear')
  })

  it('serializes behind an in-flight backfill so the wipe never lands mid-pass', async () => {
    // Bugbot pass 7 "Rebuild races coordinator backfill": stand in for an
    // EmbeddingsSync incremental pass that already holds the shared mutex. The
    // rebuild must not run `embed_clear` until that pass settles, or the wipe
    // could land mid-pass and leave part of the corpus unembedded.
    const { commands } = installBridge({ status: 'ready', model: 'all-MiniLM-L6-v2' })
    let releaseIncremental: () => void = () => {}
    const incremental = runExclusiveBackfill(
      () =>
        new Promise<void>((resolve) => {
          releaseIncremental = resolve
        }),
    )

    const rebuild = rebuildEmbeddings()
    // The rebuild may bring the runtime up (embed_ensure runs outside the lock),
    // but it must block before clearing while the incremental pass holds the lock.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(commands).toContain('embed_ensure')
    expect(commands).not.toContain('embed_clear')

    releaseIncremental()
    await Promise.all([incremental, rebuild])
    // Only once the incremental pass finished did the rebuild get to wipe.
    expect(commands).toContain('embed_clear')
  })

  it('checks isStale before a rebuild wipe', async () => {
    // A rebuild prepared for a disabled/switched brain must abort before clearing
    // vectors. Clearing first would turn a harmless stale action into index loss.
    const { commands } = installBridge(
      { status: 'ready', model: 'all-MiniLM-L6-v2' },
      { pendingChunk: true },
    )
    await expect(rebuildEmbeddings({ isStale: () => true })).resolves.toBeUndefined()
    expect(commands).not.toContain('embed_clear')
    expect(commands).not.toContain('embed_texts')
  })
})
