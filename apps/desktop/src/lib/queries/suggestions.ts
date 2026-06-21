import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { acceptSuggestion, dismissSuggestion, listOpenSuggestions } from '@local-brain/core'

/**
 * The suggestions curation queue: open project/organization proposals the
 * importer recorded but did not auto-create. Accept/dismiss invalidate broadly —
 * accepting creates a project/org and relinks cited records (tasks, interactions),
 * which fans out across Today, the projects list, and detail pages.
 */

export function useOpenSuggestions() {
  return useQuery({ queryKey: ['suggestions', 'open'], queryFn: listOpenSuggestions })
}

export function useAcceptSuggestion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => acceptSuggestion(id),
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export function useDismissSuggestion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => dismissSuggestion(id),
    onSuccess: () => queryClient.invalidateQueries(),
  })
}
