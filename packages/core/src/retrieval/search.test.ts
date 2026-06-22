import { afterEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { globalSearch } from './search'

describe('globalSearch asset results', () => {
  afterEach(() => setBridge({ invoke: () => Promise.reject(new Error('no bridge')) }))

  it('queries asset FTS and maps asset hits', async () => {
    const sqlSeen: string[] = []
    setBridge({
      invoke: (command, args) => {
        if (command !== 'db_query') return Promise.resolve(null)
        const sql = String((args as { sql?: unknown }).sql ?? '')
        sqlSeen.push(sql)
        if (sql.includes('assets_fts')) {
          return Promise.resolve([
            {
              id: 'asset-1',
              title: 'Receipt-2446-0056.pdf',
              subtitle: 'application/pdf',
              snippet: '[Receipt] 2446 0056',
              recordDate: '2026-06-18T00:00:00.000Z',
              bm25: -8,
            },
          ])
        }
        return Promise.resolve([])
      },
    })

    const hits = await globalSearch('Receipt-2446-0056', {
      now: new Date('2026-06-19T00:00:00Z'),
    })

    expect(sqlSeen.some((sql) => sql.includes('assets_fts'))).toBe(true)
    expect(hits[0]).toMatchObject({
      kind: 'asset',
      id: 'asset-1',
      title: 'Receipt-2446-0056.pdf',
      subtitle: 'application/pdf',
    })
  })

  it('skips tagged-record lookup when plain text matches no tag names', async () => {
    const sqlSeen: string[] = []
    setBridge({
      invoke: (command, args) => {
        if (command !== 'db_query') return Promise.resolve(null)
        const sql = String((args as { sql?: unknown }).sql ?? '')
        sqlSeen.push(sql)
        return Promise.resolve([])
      },
    })

    await globalSearch('not-a-tag')

    expect(sqlSeen.some((sql) => sql.includes('FROM tags'))).toBe(true)
    expect(sqlSeen.some((sql) => sql.includes('WITH records(kind'))).toBe(false)
  })
})
