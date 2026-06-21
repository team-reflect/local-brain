import { describe, expect, it } from 'vitest'
import { setBridge } from './bridge'
import { skillStatus } from './skill'
import { bridgeReturning } from '../test/bridge'

describe('skillStatus', () => {
  it('validates the native skill install status shape', async () => {
    setBridge(
      bridgeReturning({
        supported: true,
        installTargetDir: '/Users/alex/.agents/skills',
        installState: 'missing',
        skills: [
          {
            id: 'brain',
            installTargetDir: '/Users/alex/.agents/skills/brain',
            bundledHash: 'abc123abc123',
            installedHash: null,
            installState: 'missing',
          },
          {
            id: 'brain-backfill',
            installTargetDir: '/Users/alex/.agents/skills/brain-backfill',
            bundledHash: 'def456def456',
            installedHash: null,
            installState: 'missing',
          },
        ],
      }),
    )

    await expect(skillStatus()).resolves.toMatchObject({
      installTargetDir: '/Users/alex/.agents/skills',
      installState: 'missing',
      skills: [
        { id: 'brain', installTargetDir: '/Users/alex/.agents/skills/brain' },
        { id: 'brain-backfill', installTargetDir: '/Users/alex/.agents/skills/brain-backfill' },
      ],
    })
  })

  it('rejects unknown install states', async () => {
    setBridge(
      bridgeReturning({
        supported: true,
        installTargetDir: '/Users/alex/.agents/skills',
        installState: 'weird',
        skills: [],
      }),
    )

    await expect(skillStatus()).rejects.toMatchObject({ kind: 'parse' })
  })
})
