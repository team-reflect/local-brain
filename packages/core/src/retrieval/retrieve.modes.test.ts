import { afterEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { retrieve } from './retrieve'

/**
 * Orchestration tests for the lexical/semantic/hybrid modes, using a mock bridge
 * that distinguishes the lexical FTS query (`content_chunks_fts`) from the
 * semantic KNN query (`chunk_vectors`) by SQL. Real vec0/FTS behaviour is
 * covered by the Rust tests and the FTS harness; this isolates the contract:
 * when the runtime is ready, semantic contributes and `semanticAvailable` is
 * true; otherwise it degrades to lexical without failing.
 */

interface BridgeOptions {
  /** Runtime status the mocked `embed_status` reports. */
  status?: 'ready' | 'uninitialized' | 'throw'
  /** Value of the `embeddings.enabled` setting (default: enabled). */
  enabled?: boolean
}

function lexicalRow(chunkId: string, bm25: number) {
  return {
    chunkId,
    text: `lexical ${chunkId}`,
    snippet: `[${chunkId}]`,
    recordType: 'document',
    recordId: `r-${chunkId}`,
    chunkIndex: 0,
    recordTitle: 'Doc',
    recordDate: '2026-06-01T00:00:00Z',
    bm25,
  }
}

function semanticRow(chunkId: string, distance: number) {
  return {
    chunkId,
    text: `semantic ${chunkId}`,
    recordType: 'document',
    recordId: `r-${chunkId}`,
    chunkIndex: 0,
    recordTitle: 'Doc',
    distance,
  }
}

function installBridge(options: BridgeOptions = {}) {
  const commands: string[] = []
  setBridge({
    invoke: (command, args) => {
      commands.push(command)
      if (command === 'embed_status') {
        if (options.status === 'throw') return Promise.reject(new Error('no runtime'))
        return Promise.resolve(
          options.status === 'ready'
            ? { status: 'ready', model: 'all-MiniLM-L6-v2' }
            : { status: 'uninitialized' },
        )
      }
      if (command === 'embed_texts') return Promise.resolve([[0.1, 0.2, 0.3]])
      if (command === 'db_query') {
        const sql = String((args as { sql: string }).sql)
        // The `embeddings.enabled` kill-switch read (defaults to enabled here).
        if (sql.includes('settings')) {
          const enabled = options.enabled ?? true
          return Promise.resolve([{ valueJson: JSON.stringify(enabled) }])
        }
        if (sql.includes('chunk_vectors')) {
          return Promise.resolve([semanticRow('s1', 0.2), semanticRow('shared', 0.3)])
        }
        return Promise.resolve([lexicalRow('shared', -8), lexicalRow('l1', -4)])
      }
      return Promise.resolve(null)
    },
  })
  return commands
}

/**
 * A ready runtime whose vector KNN finds no neighbour within the cutoff (sparse
 * or empty vector index), while lexical FTS still has hits. Used to prove that a
 * ready-but-contributing-nothing runtime degrades to lexical instead of claiming
 * `semanticAvailable: true` with empty/unhelpful chunks.
 */
function installEmptyKnnBridge() {
  setBridge({
    invoke: (command, args) => {
      if (command === 'embed_status') {
        return Promise.resolve({ status: 'ready', model: 'all-MiniLM-L6-v2' })
      }
      if (command === 'embed_texts') return Promise.resolve([[0.1, 0.2, 0.3]])
      if (command === 'db_query') {
        const sql = String((args as { sql: string }).sql)
        if (sql.includes('settings')) return Promise.resolve([{ valueJson: 'true' }])
        if (sql.includes('chunk_vectors')) return Promise.resolve([]) // KNN: no neighbours
        return Promise.resolve([lexicalRow('l1', -4)])
      }
      return Promise.resolve(null)
    },
  })
}

describe('retrieve modes', () => {
  afterEach(() => setBridge({ invoke: () => Promise.reject(new Error('no bridge')) }))

  it('lexical mode never consults the embedding runtime', async () => {
    const commands = installBridge({ status: 'ready' })
    const result = await retrieve('quarterly planning', { mode: 'lexical' })
    expect(result.semanticAvailable).toBe(false)
    expect(commands).not.toContain('embed_status')
    expect(result.chunks.length).toBeGreaterThan(0)
  })

  it('hybrid degrades to lexical when the runtime is not ready', async () => {
    installBridge({ status: 'uninitialized' })
    const result = await retrieve('quarterly planning', { mode: 'hybrid' })
    expect(result.semanticAvailable).toBe(false)
    expect(result.chunks.every((c) => c.chunkId.startsWith('l') || c.chunkId === 'shared')).toBe(true)
  })

  it('hybrid degrades to lexical when the runtime errors', async () => {
    installBridge({ status: 'throw' })
    const result = await retrieve('quarterly planning', { mode: 'hybrid' })
    expect(result.semanticAvailable).toBe(false)
    expect(result.chunks.length).toBeGreaterThan(0)
  })

  it('hybrid fuses lexical + semantic when ready', async () => {
    installBridge({ status: 'ready' })
    const result = await retrieve('quarterly planning', { mode: 'hybrid' })
    expect(result.semanticAvailable).toBe(true)
    const ids = result.chunks.map((c) => c.chunkId)
    expect(ids).toContain('s1') // semantic-only hit
    expect(ids).toContain('l1') // lexical-only hit
    // The chunk that appears in both lists should rank first under RRF.
    expect(ids[0]).toBe('shared')
  })

  it('applies the explicit-link boost to semantic hits before hybrid fusion', async () => {
    // A bridge with no lexical matches and two semantic-only neighbours: 'a' is
    // the closer vector, 'b' is farther but lives in the active context.
    function installBoostBridge() {
      setBridge({
        invoke: (command, args) => {
          if (command === 'embed_status') return Promise.resolve({ status: 'ready', model: 'all-MiniLM-L6-v2' })
          if (command === 'embed_texts') return Promise.resolve([[0.1, 0.2, 0.3]])
          if (command === 'db_query') {
            const sql = String((args as { sql: string }).sql)
            if (sql.includes('settings')) return Promise.resolve([{ valueJson: 'true' }])
            if (sql.includes('chunk_vectors')) {
              return Promise.resolve([semanticRow('a', 0.3), semanticRow('b', 0.4)])
            }
            return Promise.resolve([]) // no lexical matches: semantic-only hits
          }
          return Promise.resolve(null)
        },
      })
    }

    installBoostBridge()
    const unboosted = await retrieve('quarterly planning', { mode: 'hybrid' })
    // Without a context boost the closer neighbour 'a' ranks first.
    expect(unboosted.chunks.map((c) => c.chunkId)).toEqual(['a', 'b'])

    installBoostBridge()
    const boosted = await retrieve('quarterly planning', {
      mode: 'hybrid',
      boostRecordIds: ['r-b'],
    })
    // The explicit context-link boost lifts the farther 'b' above 'a' BEFORE RRF
    // fuses the lists — proving the boost reaches semantic-only vector hits.
    expect(boosted.chunks[0]?.chunkId).toBe('b')
  })

  it('semantic mode returns only vector hits and reports availability', async () => {
    installBridge({ status: 'ready' })
    const result = await retrieve('quarterly planning', { mode: 'semantic' })
    expect(result.semanticAvailable).toBe(true)
    expect(result.chunks.map((c) => c.chunkId).sort()).toEqual(['s1', 'shared'])
  })

  it('hybrid degrades to lexical when semantic search is disabled, even if the runtime is ready', async () => {
    const commands = installBridge({ status: 'ready', enabled: false })
    const result = await retrieve('quarterly planning', { mode: 'hybrid' })
    expect(result.semanticAvailable).toBe(false)
    // The kill-switch must short-circuit before any embed work touches vectors.
    expect(commands).not.toContain('embed_status')
    expect(commands).not.toContain('embed_texts')
    expect(result.chunks.every((c) => c.chunkId.startsWith('l') || c.chunkId === 'shared')).toBe(true)
  })

  it('semantic mode returns no vector hits when semantic search is disabled', async () => {
    const commands = installBridge({ status: 'ready', enabled: false })
    const result = await retrieve('quarterly planning', { mode: 'semantic' })
    expect(result.semanticAvailable).toBe(false)
    expect(commands).not.toContain('embed_texts')
  })

  it('hybrid does not run semantic KNN for a whitespace-only query', async () => {
    const commands = installBridge({ status: 'ready' })
    const result = await retrieve('   \n\t ', { mode: 'hybrid' })
    // A blank query has no semantic signal: it must not embed or run KNN, and must
    // not claim semantic availability just because the runtime is ready.
    expect(result.semanticAvailable).toBe(false)
    expect(commands).not.toContain('embed_status')
    expect(commands).not.toContain('embed_texts')
  })

  it('hybrid degrades to lexical when KNN yields no neighbours within cutoff', async () => {
    // The runtime is ready and the query embeds, but the vector index returns no
    // neighbour. Semantic contributed nothing, so `semanticAvailable` must be
    // false and the lexical hits must still stand (no empty result).
    installEmptyKnnBridge()
    const result = await retrieve('quarterly planning', { mode: 'hybrid' })
    expect(result.semanticAvailable).toBe(false)
    expect(result.chunks.map((c) => c.chunkId)).toContain('l1')
  })

  it('semantic mode falls back to lexical when KNN yields no neighbours', async () => {
    // A ready runtime that contributes nothing must not return empty while lexical
    // hits exist, nor claim semantic availability — mirroring the unavailable path.
    installEmptyKnnBridge()
    const result = await retrieve('quarterly planning', { mode: 'semantic' })
    expect(result.semanticAvailable).toBe(false)
    expect(result.chunks.map((c) => c.chunkId)).toContain('l1')
  })

  it('semantic mode returns no results for a whitespace-only query', async () => {
    const commands = installBridge({ status: 'ready' })
    const result = await retrieve('   ', { mode: 'semantic' })
    expect(result.semanticAvailable).toBe(false)
    expect(result.chunks).toEqual([])
    expect(commands).not.toContain('embed_texts')
  })
})
