import { describe, expect, it } from 'vitest'
import {
  databasePath,
  keychainGet,
  keychainSet,
} from './storage'
import { captureBridge } from '../test/bridge'

describe('storage IPC bindings', () => {
  it('keychain bindings round-trip an account and a nullable secret', async () => {
    const setCalls = captureBridge(null)
    await keychainSet('anthropic', 'sk-test')
    expect(setCalls[0]).toEqual({
      command: 'keychain_set',
      args: { account: 'anthropic', secret: 'sk-test' },
    })

    captureBridge('sk-stored')
    expect(await keychainGet('anthropic')).toBe('sk-stored')

    captureBridge(null)
    expect(await keychainGet('missing')).toBeNull()
  })

  it('databasePath validates a string response', async () => {
    captureBridge('/data/local-brain/brain.sqlite')
    expect(await databasePath()).toBe('/data/local-brain/brain.sqlite')
  })
})
