import { useQuery } from '@tanstack/react-query'
import { globalSearch, quickSearch } from '@local-brain/core'

/** Search hooks: navigational quick-search for the palette and full-text global search. */

/** Quick search (command palette record results). */
export function useQuickSearch(query: string) {
  const trimmed = query.trim()
  return useQuery({
    queryKey: ['quick-search', trimmed],
    queryFn: () => quickSearch(trimmed),
    enabled: trimmed.length > 0,
  })
}

/** Full-text global search across record types (Plan 06). */
export function useGlobalSearch(query: string) {
  const trimmed = query.trim()
  return useQuery({
    queryKey: ['global-search', trimmed],
    queryFn: () => globalSearch(trimmed),
    enabled: trimmed.length > 0,
  })
}
