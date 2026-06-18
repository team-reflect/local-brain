import { afterEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from './bridge'
import {
  databasePath,
  keychainGet,
  keychainSet,
} from './storage'

/** Capture the command + args each binding sends, and return a canned response. */
function capture(response: unknown) {
  const invoke = vi.fn(async () => response)
  setBridge({ invoke })
  return invoke
}

afterEach(() => vi.restoreAllMocks())

describe('storage IPC bindings', () => {
  it('keychain bindings round-trip an account and a nullable secret', async () => {
    const setInvoke = capture(null)
    await keychainSet('anthropic', 'sk-test')
    expect(setInvoke).toHaveBeenCalledWith('keychain_set', { account: 'anthropic', secret: 'sk-test' })

    capture('sk-stored')
    expect(await keychainGet('anthropic')).toBe('sk-stored')

    capture(null)
    expect(await keychainGet('missing')).toBeNull()
  })

  it('databasePath validates a string response', async () => {
    capture('/data/local-brain/brain.sqlite')
    expect(await databasePath()).toBe('/data/local-brain/brain.sqlite')
  })
})
