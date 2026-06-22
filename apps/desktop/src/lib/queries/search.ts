import { useQuery } from '@tanstack/react-query'
import { globalSearch } from '@local-brain/core'

/** Search hooks: full-text global search for the command palette. */

/** Full-text global search across record types (Plan 06). */
export function useGlobalSearch(query: string) {
  const trimmed = query.trim()
  return useQuery({
    queryKey: ['global-search', trimmed],
    queryFn: () => globalSearch(trimmed),
    enabled: trimmed.length > 0,
  })
}
