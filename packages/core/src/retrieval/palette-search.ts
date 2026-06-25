import type { RecordKind } from '../domains/relations/types'
import { parseSearchQuery } from './search-query'
import { globalSearch } from './search'
import type { SearchHit } from './search-types'
import { retrieve, type RetrievedChunk, type SourceRecordType } from './retrieve'

const RRF_K = 60
const DEFAULT_LIMIT = 20

const NAVIGABLE_RETRIEVAL_TYPES = [
  'person',
  'organization',
  'project',
  'task',
  'document',
  'interaction',
  'asset',
] as const satisfies readonly SourceRecordType[]

function navigableKind(type: SourceRecordType): RecordKind | null {
  return NAVIGABLE_RETRIEVAL_TYPES.includes(type as (typeof NAVIGABLE_RETRIEVAL_TYPES)[number])
    ? (type as RecordKind)
    : null
}

function keyOf(hit: Pick<SearchHit, 'kind' | 'id'>): string {
  return `${hit.kind}:${hit.id}`
}

function semanticSearchHits(chunks: readonly RetrievedChunk[]): SearchHit[] {
  const byRecord = new Map<string, SearchHit>()
  for (const chunk of chunks) {
    const kind = navigableKind(chunk.recordType)
    if (!kind) continue

    const hit: SearchHit = {
      kind,
      id: chunk.recordId,
      title: chunk.recordTitle ?? '(untitled)',
      subtitle: null,
      snippet: chunk.snippet || null,
      score: chunk.semanticScore ?? chunk.score,
    }
    const existing = byRecord.get(keyOf(hit))
    if (!existing || hit.score > existing.score) {
      byRecord.set(keyOf(hit), hit)
    }
  }
  return [...byRecord.values()]
}

function fusePaletteHits(lexical: readonly SearchHit[], semantic: readonly SearchHit[], limit: number): SearchHit[] {
  const fused = new Map<string, { hit: SearchHit; score: number }>()
  for (const list of [lexical, semantic]) {
    list.forEach((hit, index) => {
      const key = keyOf(hit)
      const contribution = 1 / (RRF_K + index + 1)
      const existing = fused.get(key)
      if (existing) {
        existing.score += contribution
        if (existing.hit.snippet === null && hit.snippet !== null) {
          existing.hit = { ...existing.hit, snippet: hit.snippet }
        }
      } else {
        fused.set(key, { hit: { ...hit }, score: contribution })
      }
    })
  }

  return [...fused.values()]
    .sort((a, b) => b.score - a.score || a.hit.title.localeCompare(b.hit.title))
    .slice(0, limit)
    .map(({ hit, score }) => ({ ...hit, score }))
}

/**
 * Command-palette search: existing global lexical/name/tag search plus semantic
 * supplementation for plain-text queries when local vectors can contribute.
 */
export async function paletteSearch(query: string, options: { limit?: number } = {}): Promise<SearchHit[]> {
  const limit = options.limit ?? DEFAULT_LIMIT
  const parsed = parseSearchQuery(query)
  const lexical = await globalSearch(query, { limit })

  if (parsed.tagFilters.length > 0 || parsed.text.trim().length === 0) {
    return lexical
  }

  const semantic = await retrieve(parsed.text, {
    mode: 'semantic',
    limit,
    recordTypes: NAVIGABLE_RETRIEVAL_TYPES,
  })
  if (!semantic.semanticAvailable) {
    return lexical
  }

  return fusePaletteHits(lexical, semanticSearchHits(semantic.chunks), limit)
}
