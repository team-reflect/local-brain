import { setBridge } from '@local-brain/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkPrivateGithubUpdate } from './private-update'

// `new Update(...)` needs a live Tauri runtime, so stand in a class that just
// captures the options the binding passes it.
vi.mock('@tauri-apps/plugin-updater', () => ({
  Update: class {
    constructor(options: Record<string, unknown>) {
      Object.assign(this, options)
    }
  },
}))

/** Install a one-shot fake IPC bridge that answers the update command. */
function bridgeReturning(payload: unknown): void {
  setBridge({ invoke: () => Promise.resolve(payload) })
}

describe('checkPrivateGithubUpdate', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    setBridge(null)
  })

  it('accepts an available update whose body/date come back as null', async () => {
    // Exactly what the Rust command serializes: a Tauri manifest carries no
    // notes, so `body` (and a date-less manifest's `date`) arrive as JSON null.
    // This is the case that regressed updates to the always-404 public feed.
    bridgeReturning({
      rid: 3,
      currentVersion: '0.1.7',
      version: '0.1.8',
      date: null,
      body: null,
      rawJson: { version: '0.1.8', platforms: {} },
    })

    const update = await checkPrivateGithubUpdate()
    expect(update).not.toBeNull()
    expect(update?.version).toBe('0.1.8')
  })

  it('returns null when the backend reports no update', async () => {
    bridgeReturning(null)
    expect(await checkPrivateGithubUpdate()).toBeNull()
  })

  it('still rejects a genuinely malformed payload', async () => {
    bridgeReturning({ rid: 'not-a-number', version: 5 })
    await expect(checkPrivateGithubUpdate()).rejects.toMatchObject({ kind: 'parse' })
  })
})
