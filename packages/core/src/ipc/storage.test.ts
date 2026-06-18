import { describe, expect, it } from 'vitest'
import {
  backupDatabase,
  databasePath,
  keychainGet,
  keychainSet,
  writeFileAtomic,
} from './storage'
import { captureBridge } from '../test/bridge'

describe('storage IPC bindings', () => {
  it('backupDatabase forwards the destination and validates the response', async () => {
    const calls = captureBridge({ path: '/tmp/b.sqlite', schemaVersion: 2, sizeBytes: 4096 })
    const info = await backupDatabase('/tmp/b.sqlite')
    expect(calls[0]).toEqual({ command: 'backup_database', args: { dest: '/tmp/b.sqlite' } })
    expect(info).toEqual({ path: '/tmp/b.sqlite', schemaVersion: 2, sizeBytes: 4096 })
  })

  it('writeFileAtomic forwards dest + contents and returns the byte count', async () => {
    const calls = captureBridge(11)
    const n = await writeFileAtomic('/tmp/x.json', '{"ok":true}')
    expect(calls[0]).toEqual({
      command: 'write_file_atomic',
      args: { dest: '/tmp/x.json', contents: '{"ok":true}' },
    })
    expect(n).toBe(11)
  })

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
