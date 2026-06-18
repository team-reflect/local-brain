import { afterEach, describe, expect, it } from 'vitest'
import { type EmbeddingsStatus, type EmbedStatus, setBridge } from '@local-brain/core'
import { runExclusiveBackfill } from '../embeddings-coordinator'
import { embeddingsRefetchInterval, rebuildEmbeddings } from './embeddings'

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
}

function installBridge(
  ensure: EmbedStatus,
  options: { pendingChunk?: boolean; failEmbed?: boolean } = {},
): BridgeHandle {
  const commands: string[] = []
  let persistedError: string | null = null
  setBridge({
    invoke: (command, args) => {
      commands.push(command)
      const params = ((args as { params?: unknown[] }).params ?? []) as unknown[]
      switch (command) {
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
          if (sql.includes('settings') && params[0] === 'embeddings.backfillError') {
            persistedError = JSON.parse(String(params[1])) as string | null
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
  return { commands, persistedError: () => persistedError }
}

/**
 * Polling-cadence contract (Bugbot "Stale pending stops CLI indexing"): once the
 * runtime is ready and `pending` hits 0 the status query must NOT go silent — a
 * non-UI writer (the `brain` CLI, another window) can add chunks without
 * invalidating this query, so the poll has to keep a slow heartbeat to notice
 * them. Failed runtimes and sticky backfill errors still stop polling entirely.
 */
function status(overrides: Partial<EmbeddingsStatus> = {}): EmbeddingsStatus {
  return {
    enabled: true,
    runtime: { status: 'ready', model: 'all-MiniLM-L6-v2' },
    modelId: 'all-MiniLM-L6-v2',
    indexed: 10,
    totalChunks: 10,
    pending: 0,
    ready: true,
    backfillError: null,
    ...overrides,
  }
}

describe('embeddingsRefetchInterval', () => {
  it('does not poll before data loads or when disabled', () => {
    expect(embeddingsRefetchInterval(undefined)).toBe(false)
    expect(embeddingsRefetchInterval(status({ enabled: false }))).toBe(false)
  })

  it('fast-polls while the model loads or chunks are pending', () => {
    expect(embeddingsRefetchInterval(status({ runtime: { status: 'loading' } }))).toBe(1500)
    expect(embeddingsRefetchInterval(status({ pending: 4, ready: false }))).toBe(1500)
  })

  it('keeps a slow heartbeat when idle so externally written chunks get noticed', () => {
    // Ready, nothing pending, healthy: an earlier "stop at pending 0" left CLI
    // writes unembedded until a focus refetch. The heartbeat keeps it live.
    expect(embeddingsRefetchInterval(status())).toBe(30_000)
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

  it('threads isStale into the rebuild backfill so a mid-rebuild disable aborts', async () => {
    // Bugbot pass 7 "Rebuild ignores disable abort": a manual rebuild must honor
    // the same cooperative abort as the incremental pass. With `isStale` already
    // true the backfill aborts before its first batch, so the wipe happened but
    // no chunk is re-embedded.
    const { commands } = installBridge(
      { status: 'ready', model: 'all-MiniLM-L6-v2' },
      { pendingChunk: true },
    )
    await expect(rebuildEmbeddings({ isStale: () => true })).resolves.toBeUndefined()
    expect(commands).toContain('embed_clear')
    expect(commands).not.toContain('embed_texts')
  })
})
