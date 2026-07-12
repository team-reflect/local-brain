import { afterEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { applyExtraction } from './apply'
import { parseExtractionResult } from './contracts'

const CAPTURED_IDENTITY = {
  databasePath: '/test/brain-a.sqlite',
  generation: 7,
} as const

afterEach(() => setBridge(null))

describe('applyExtraction database identity', () => {
  it('pins every pre-apply read to the one captured identity', async () => {
    const readArgs: Record<string, unknown>[] = []
    setBridge({
      invoke(command, args) {
        if (command === 'active_database_identity') return Promise.resolve(CAPTURED_IDENTITY)
        if (command === 'db_query') {
          readArgs.push(args)
          return Promise.resolve([])
        }
        return Promise.reject(new Error(`unexpected command: ${command}`))
      },
    })

    await applyExtraction(
      { recordType: 'document', recordId: 'document-1' },
      parseExtractionResult({}),
    )

    expect(readArgs.length).toBeGreaterThan(0)
    expect(readArgs).toEqual(
      readArgs.map((args) => ({
        ...args,
        expectedDatabasePath: CAPTURED_IDENTITY.databasePath,
        expectedGeneration: CAPTURED_IDENTITY.generation,
      })),
    )
  })

  it('rejects a no-op summary when the active brain changes after its reads', async () => {
    let identityCalls = 0
    setBridge({
      invoke(command) {
        if (command === 'active_database_identity') {
          identityCalls += 1
          return Promise.resolve(
            identityCalls === 1
              ? CAPTURED_IDENTITY
              : { databasePath: '/test/brain-b.sqlite', generation: 8 },
          )
        }
        if (command === 'db_query') return Promise.resolve([])
        return Promise.reject(new Error(`unexpected command: ${command}`))
      },
    })

    await expect(
      applyExtraction(
        { recordType: 'document', recordId: 'document-1' },
        parseExtractionResult({}),
      ),
    ).rejects.toMatchObject({
      kind: 'stale',
      message: expect.stringContaining('active brain changed'),
    })
  })
})
