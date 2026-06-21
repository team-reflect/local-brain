import { describe, expect, it } from 'vitest'
import { setBridge } from './bridge'
import { skillStatus } from './skill'
import { bridgeReturning } from '../test/bridge'

describe('skillStatus', () => {
  it('validates the native skill install status shape', async () => {
    setBridge(
      bridgeReturning({
        supported: true,
        installTargetPath: '/Users/alex/.agents/skills/brain/SKILL.md',
        installTargetDir: '/Users/alex/.agents/skills/brain',
        bundledHash: 'abc123abc123',
        installedHash: null,
        installState: 'missing',
      }),
    )

    await expect(skillStatus()).resolves.toMatchObject({
      installTargetPath: '/Users/alex/.agents/skills/brain/SKILL.md',
      installState: 'missing',
    })
  })

  it('rejects unknown install states', async () => {
    setBridge(
      bridgeReturning({
        supported: true,
        installTargetPath: '/Users/alex/.agents/skills/brain/SKILL.md',
        installTargetDir: '/Users/alex/.agents/skills/brain',
        bundledHash: 'abc123abc123',
        installedHash: null,
        installState: 'weird',
      }),
    )

    await expect(skillStatus()).rejects.toMatchObject({ kind: 'parse' })
  })
})
