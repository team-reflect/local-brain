import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { paletteSearch, type SearchHit } from '@local-brain/core'

/** Search hooks for the command palette. */

export const PALETTE_SEARCH_QUERY_KEY = ['palette-search'] as const

/** Command-palette search across record types, semantically supplemented when available. */
export function usePaletteSearch(query: string): UseQueryResult<SearchHit[]> {
  const trimmed = query.trim()
  return useQuery({
    queryKey: [...PALETTE_SEARCH_QUERY_KEY, trimmed],
    queryFn: () => paletteSearch(trimmed),
    enabled: trimmed.length > 0,
  })
}
