import { afterEach, describe, expect, it } from 'vitest'
import { type EmbedStatus, setBridge } from '@local-brain/core'
import { rebuildEmbeddings } from './embeddings'

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
          if (sql.includes('is null')) return Promise.resolve([]) // no orphans
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
        default:
          return Promise.resolve(null)
      }
    },
  })
  return { commands, persistedError: () => persistedError }
}

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
})
