import { useQuery } from '@tanstack/react-query'
import { paletteSearch } from '@local-brain/core'

/** Search hooks: global + semantic search for the command palette. */

/** Command-palette search across record types, semantically supplemented when available. */
export function usePaletteSearch(query: string) {
  const trimmed = query.trim()
  return useQuery({
    queryKey: ['palette-search', trimmed],
    queryFn: () => paletteSearch(trimmed),
    enabled: trimmed.length > 0,
  })
}
