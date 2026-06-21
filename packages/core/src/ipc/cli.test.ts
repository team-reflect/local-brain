import { describe, expect, it } from 'vitest'
import { setBridge } from './bridge'
import { cliStatus } from './cli'
import { bridgeReturning } from '../test/bridge'

describe('cliStatus', () => {
  it('validates the native CLI install status shape', async () => {
    setBridge(
      bridgeReturning({
        supported: true,
        bundledPath: '/Applications/Local Brain.app/Contents/MacOS/brain',
        bundledVersion: 'brain 0.1.0',
        installTargetPath: '/Users/alex/.local/bin/brain',
        installTargetDir: '/Users/alex/.local/bin',
        targetDirOnPath: true,
        installedPath: null,
        installedVersion: null,
        installState: 'missing',
      }),
    )

    await expect(cliStatus()).resolves.toMatchObject({
      installTargetPath: '/Users/alex/.local/bin/brain',
      installState: 'missing',
    })
  })

  it('rejects unknown install states', async () => {
    setBridge(
      bridgeReturning({
        supported: true,
        bundledPath: '/Applications/Local Brain.app/Contents/MacOS/brain',
        bundledVersion: 'brain 0.1.0',
        installTargetPath: '/Users/alex/.local/bin/brain',
        installTargetDir: '/Users/alex/.local/bin',
        targetDirOnPath: true,
        installedPath: null,
        installedVersion: null,
        installState: 'weird',
      }),
    )

    await expect(cliStatus()).rejects.toMatchObject({ kind: 'parse' })
  })
})
