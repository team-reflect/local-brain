import { afterEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from './bridge'
import {
  backupDatabase,
  databasePath,
  keychainGet,
  keychainSet,
  writeFileAtomic,
} from './storage'

/** Capture the command + args each binding sends, and return a canned response. */
function capture(response: unknown) {
  const invoke = vi.fn(async () => response)
  setBridge({ invoke })
  return invoke
}

afterEach(() => vi.restoreAllMocks())

describe('storage IPC bindings', () => {
  it('backupDatabase forwards the destination and validates the response', async () => {
    const invoke = capture({ path: '/tmp/b.sqlite', schemaVersion: 2, sizeBytes: 4096 })
    const info = await backupDatabase('/tmp/b.sqlite')
    expect(invoke).toHaveBeenCalledWith('backup_database', { dest: '/tmp/b.sqlite' })
    expect(info).toEqual({ path: '/tmp/b.sqlite', schemaVersion: 2, sizeBytes: 4096 })
  })

  it('writeFileAtomic forwards dest + contents and returns the byte count', async () => {
    const invoke = capture(11)
    const n = await writeFileAtomic('/tmp/x.json', '{"ok":true}')
    expect(invoke).toHaveBeenCalledWith('write_file_atomic', { dest: '/tmp/x.json', contents: '{"ok":true}' })
    expect(n).toBe(11)
  })

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
