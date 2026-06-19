import { afterEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { quickSearch } from './getters'

describe('quickSearch asset results', () => {
  afterEach(() => setBridge({ invoke: () => Promise.reject(new Error('no bridge')) }))

  it('includes assets by filename metadata', async () => {
    setBridge({
      invoke: (command, args) => {
        if (command !== 'db_query') return Promise.resolve(null)
        const sql = String((args as { sql?: unknown }).sql ?? '')
        if (sql.includes('FROM assets')) {
          return Promise.resolve([
            {
              id: 'asset-1',
              title: 'Receipt-2446-0056.pdf',
              subtitle: 'application/pdf',
            },
          ])
        }
        return Promise.resolve([])
      },
    })

    await expect(quickSearch('Receipt-2446')).resolves.toEqual([
      {
        kind: 'asset',
        id: 'asset-1',
        title: 'Receipt-2446-0056.pdf',
        subtitle: 'application/pdf',
      },
    ])
  })
})
