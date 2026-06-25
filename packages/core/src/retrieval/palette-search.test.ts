import { afterEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { paletteSearch } from './palette-search'

function lexicalDocumentRow(id: string, title: string, snippet: string | null = null) {
  return {
    id,
    title,
    subtitle: 'note',
    snippet,
    recordDate: '2026-06-01T00:00:00.000Z',
    bm25: -8,
  }
}

function semanticRow(overrides: {
  chunkId: string
  recordType: string
  recordId: string
  recordTitle: string
  text?: string
  distance?: number
}) {
  return {
    text: overrides.text ?? `semantic text ${overrides.chunkId}`,
    chunkIndex: 0,
    distance: overrides.distance ?? 0.2,
    ...overrides,
  }
}

function installPaletteBridge(options: {
  lexicalRows?: unknown[]
  semanticRows?: unknown[]
  enabled?: boolean
  ready?: boolean
}) {
  const commands: string[] = []
  setBridge({
    invoke: (command, args) => {
      commands.push(command)
      if (command === 'embed_status') {
        return Promise.resolve(
          options.ready === false
            ? { status: 'uninitialized' }
            : { status: 'ready', model: 'all-MiniLM-L6-v2' },
        )
      }
      if (command === 'embed_texts') return Promise.resolve([[0.1, 0.2, 0.3]])
      if (command === 'db_query') {
        const sql = String((args as { sql: string }).sql)
        if (sql.includes('settings')) {
          return Promise.resolve([{ valueJson: JSON.stringify(options.enabled ?? true) }])
        }
        if (sql.includes('chunk_vectors')) {
          return Promise.resolve(options.semanticRows ?? [])
        }
        if (sql.includes('documents_fts')) {
          return Promise.resolve(options.lexicalRows ?? [])
        }
        return Promise.resolve([])
      }
      return Promise.resolve(null)
    },
  })
  return commands
}

describe('paletteSearch', () => {
  afterEach(() => setBridge({ invoke: () => Promise.reject(new Error('no bridge')) }))

  it('returns lexical results when semantic search is disabled', async () => {
    const commands = installPaletteBridge({
      enabled: false,
      lexicalRows: [lexicalDocumentRow('d1', 'Lexical note', '[Lexical] note')],
      semanticRows: [
        semanticRow({ chunkId: 's1', recordType: 'document', recordId: 'd2', recordTitle: 'Semantic note' }),
      ],
    })

    const hits = await paletteSearch('planning')

    expect(hits.map((hit) => hit.id)).toEqual(['d1'])
    expect(commands).not.toContain('embed_status')
    expect(commands).not.toContain('embed_texts')
  })

  it('includes a semantic-only navigable result when vectors contribute', async () => {
    installPaletteBridge({
      semanticRows: [
        semanticRow({
          chunkId: 's1',
          recordType: 'document',
          recordId: 'd1',
          recordTitle: 'Strategy memo',
          text: 'long-range positioning notes',
        }),
      ],
    })

    const hits = await paletteSearch('competitive moat')

    expect(hits).toMatchObject([
      {
        kind: 'document',
        id: 'd1',
        title: 'Strategy memo',
        snippet: 'long-range positioning notes',
      },
    ])
  })

  it('fuses duplicate lexical and semantic records into one hit and keeps the lexical snippet', async () => {
    installPaletteBridge({
      lexicalRows: [lexicalDocumentRow('d1', 'Lexical title', '[budget] plan')],
      semanticRows: [
        semanticRow({
          chunkId: 's1',
          recordType: 'document',
          recordId: 'd1',
          recordTitle: 'Semantic title',
          text: 'semantic budget context',
        }),
      ],
    })

    const hits = await paletteSearch('budget')

    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      kind: 'document',
      id: 'd1',
      title: 'Lexical title',
      subtitle: 'note',
      snippet: '[budget] plan',
    })
  })

  it('does not run semantic retrieval for tag-filtered queries', async () => {
    const commands = installPaletteBridge({
      lexicalRows: [lexicalDocumentRow('d1', 'Travel plan', '[travel] budget')],
      semanticRows: [
        semanticRow({ chunkId: 's1', recordType: 'document', recordId: 'd2', recordTitle: 'Semantic note' }),
      ],
    })

    const hits = await paletteSearch('budget #travel')

    expect(hits.map((hit) => hit.id)).toEqual(['d1'])
    expect(commands).not.toContain('embed_status')
    expect(commands).not.toContain('embed_texts')
  })

  it('ignores non-navigable semantic source types', async () => {
    installPaletteBridge({
      semanticRows: [
        semanticRow({
          chunkId: 'profile',
          recordType: 'organization_profile',
          recordId: 'op1',
          recordTitle: 'Profile',
        }),
        semanticRow({
          chunkId: 'doc',
          recordType: 'document',
          recordId: 'd1',
          recordTitle: 'Navigable document',
        }),
      ],
    })

    const hits = await paletteSearch('market profile')

    expect(hits.map((hit) => `${hit.kind}:${hit.id}`)).toEqual(['document:d1'])
  })

  it('falls back to lexical hits when semantic contributes only non-navigable rows', async () => {
    installPaletteBridge({
      lexicalRows: [lexicalDocumentRow('d1', 'Lexical document', '[market] note')],
      semanticRows: [
        semanticRow({
          chunkId: 'profile',
          recordType: 'organization_profile',
          recordId: 'op1',
          recordTitle: 'Profile',
        }),
      ],
    })

    const hits = await paletteSearch('market profile')

    expect(hits.map((hit) => `${hit.kind}:${hit.id}`)).toEqual(['document:d1'])
    expect(hits[0]?.snippet).toBe('[market] note')
  })
})
