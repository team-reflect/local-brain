import { afterEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { filteredSearch } from './filtered-search'

function semanticRow() {
  return {
    recordType: 'document',
    recordId: 'doc-semantic',
    title: 'Semantic document',
    kind: 'note',
    status: null,
    date: '2026-06-18T00:00:00Z',
    createdAt: '2026-06-18T00:00:00Z',
    updatedAt: '2026-06-18T00:00:00Z',
    parentRecordType: null,
    parentRecordId: null,
    parentTitle: null,
    hasTranscript: 0,
    chunkId: 'chunk-semantic',
    chunkIndex: 0,
    snippet: 'semantic-only meaning match',
    text: 'semantic-only meaning match',
    bm25: null,
    semanticScore: 0.82,
  }
}

function lexicalRow() {
  return {
    recordType: 'document',
    recordId: 'doc-lexical',
    title: 'Lexical document',
    kind: 'note',
    status: null,
    date: '2026-06-17T00:00:00Z',
    createdAt: '2026-06-17T00:00:00Z',
    updatedAt: '2026-06-17T00:00:00Z',
    parentRecordType: null,
    parentRecordId: null,
    parentTitle: null,
    hasTranscript: 0,
    chunkId: 'chunk-lexical',
    chunkIndex: 0,
    snippet: '[budget]',
    text: 'budget keyword match',
    bm25: -8,
    semanticScore: null,
  }
}

describe('filteredSearch semantic orchestration', () => {
  afterEach(() => setBridge({ invoke: () => Promise.reject(new Error('no bridge')) }))

  it('lets hybrid search contribute semantic-only chunk hits', async () => {
    setBridge({
      invoke: (command, args) => {
        if (command === 'embed_status') return Promise.resolve({ status: 'ready', model: 'all-MiniLM-L6-v2' })
        if (command === 'embed_texts') return Promise.resolve([[0.1, 0.2, 0.3]])
        if (command === 'db_query') {
          const query = String((args as { sql: string }).sql)
          if (query.includes('settings')) return Promise.resolve([{ valueJson: 'true' }])
          if (query.includes('chunk_vectors')) return Promise.resolve([semanticRow()])
          return Promise.resolve([])
        }
        return Promise.resolve(null)
      },
    })

    const result = await filteredSearch({ query: 'meaningful ask', recordTypes: ['document'] })

    expect(result.semanticAvailable).toBe(true)
    expect(result.hits.map((hit) => hit.recordId)).toContain('doc-semantic')
    expect(result.hits[0]?.semanticScore ?? 0).toBeGreaterThan(0)
  })

  it('does not embed when semantic search is disabled and still returns lexical hits', async () => {
    const commands: string[] = []
    setBridge({
      invoke: (command, args) => {
        commands.push(command)
        if (command === 'db_query') {
          const query = String((args as { sql: string }).sql)
          if (query.includes('settings')) return Promise.resolve([{ valueJson: 'false' }])
          if (query.includes('content_chunks_fts')) return Promise.resolve([lexicalRow()])
          return Promise.resolve([])
        }
        return Promise.resolve(null)
      },
    })

    const result = await filteredSearch({ query: 'budget', recordTypes: ['document'] })

    expect(commands).not.toContain('embed_status')
    expect(commands).not.toContain('embed_texts')
    expect(result.semanticAvailable).toBe(false)
    expect(result.hits.map((hit) => hit.recordId)).toEqual(['doc-lexical'])
  })
})
