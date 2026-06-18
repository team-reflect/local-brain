import { afterEach, describe, expect, it } from 'vitest'
import { type EmbedStatus, setBridge } from '@local-brain/core'
import { rebuildEmbeddings } from './embeddings'

/**
 * Rebuild safety contract (Bugbot #27 high-severity fix): the rebuild must never
 * clear the existing vector projection unless `embed_ensure` reports the runtime
 * is actually `ready`. A `loading` (concurrent load) or `failed` result must
 * abort *before* `embed_clear`, so a model that can't load can't wipe the index.
 */

function installBridge(ensure: EmbedStatus): string[] {
  const commands: string[] = []
  setBridge({
    invoke: (command) => {
      commands.push(command)
      switch (command) {
        case 'embed_ensure':
          return Promise.resolve(ensure)
        case 'embed_clear':
        case 'embed_apply':
        case 'embed_delete':
          return Promise.resolve(0)
        // backfill's prune + pending scans read an empty content set here.
        case 'db_query':
          return Promise.resolve([])
        default:
          return Promise.resolve(null)
      }
    },
  })
  return commands
}

describe('rebuildEmbeddings', () => {
  afterEach(() => setBridge({ invoke: () => Promise.reject(new Error('no bridge')) }))

  it('clears and backfills when the runtime is ready', async () => {
    const commands = installBridge({ status: 'ready', model: 'all-MiniLM-L6-v2' })
    await expect(rebuildEmbeddings()).resolves.toBeUndefined()
    expect(commands).toContain('embed_ensure')
    expect(commands).toContain('embed_clear')
  })

  it('does not clear when ensure resolves still loading', async () => {
    const commands = installBridge({ status: 'loading' })
    await expect(rebuildEmbeddings()).rejects.toThrow(/still loading/)
    expect(commands).toContain('embed_ensure')
    expect(commands).not.toContain('embed_clear')
  })

  it('does not clear when the model failed to load', async () => {
    const commands = installBridge({ status: 'failed', message: 'onnx blew up' })
    await expect(rebuildEmbeddings()).rejects.toThrow(/failed to load: onnx blew up/)
    expect(commands).not.toContain('embed_clear')
  })
})
