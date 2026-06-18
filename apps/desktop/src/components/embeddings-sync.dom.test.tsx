// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type EmbedStatus, setBridge } from '@local-brain/core'
import { act, render, waitFor } from '@testing-library/react'
import { EmbeddingsSync } from './embeddings-sync'

/**
 * Auto-load policy (Bugbot #27 follow-up): `EmbeddingsSync` brings the runtime up
 * from `uninitialized`, but a `failed` runtime must NOT be retried on every poll —
 * a permanent load error would otherwise re-trigger the full download/load every
 * 1.5s. Recovery is user-driven (re-enable / Rebuild index), not automatic.
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
          if (sql.includes('settings')) return Promise.resolve([{ valueJson: 'true' }]) // enabled
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
})
