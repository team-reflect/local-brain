import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  activeBrain,
  createBrain,
  forgetBrain,
  listBrains,
  openBrain,
  renameBrain,
  revealBrain,
  setBrainColor,
  type BrainColor,
} from '@local-brain/core'

/**
 * Hooks for the top-level brain picker. Switching the active brain (open/create)
 * swaps the Rust connection, so the entire query cache is invalidated to refetch
 * every surface against the newly active brain; the shell also remounts (keyed
 * by the active brain path) for a clean history. Metadata-only edits (rename,
 * color) just refresh the brain lists.
 */

export const BRAINS_KEY = ['brains'] as const
export const ACTIVE_BRAIN_KEY = ['active-brain'] as const

export function useBrains() {
  return useQuery({ queryKey: BRAINS_KEY, queryFn: listBrains })
}

export function useActiveBrain() {
  return useQuery({ queryKey: ACTIVE_BRAIN_KEY, queryFn: activeBrain })
}

/** Invalidate everything: a brain switch changes what every other query reads. */
function useSwitchInvalidation() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries()
}

export function useOpenBrain() {
  const invalidateAll = useSwitchInvalidation()
  return useMutation({
    mutationFn: (path: string) => openBrain(path),
    onSuccess: invalidateAll,
  })
}

export function useCreateBrain() {
  const invalidateAll = useSwitchInvalidation()
  return useMutation({
    mutationFn: (vars: { path: string; name?: string }) => createBrain(vars.path, vars.name),
    onSuccess: invalidateAll,
  })
}

export function useRenameBrain() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { path: string; name: string }) => renameBrain(vars.path, vars.name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BRAINS_KEY })
      void queryClient.invalidateQueries({ queryKey: ACTIVE_BRAIN_KEY })
    },
  })
}

export function useSetBrainColor() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { path: string; color: BrainColor }) => setBrainColor(vars.path, vars.color),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BRAINS_KEY })
      void queryClient.invalidateQueries({ queryKey: ACTIVE_BRAIN_KEY })
    },
  })
}

export function useForgetBrain() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (path: string) => forgetBrain(path),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: BRAINS_KEY }),
  })
}

export function useRevealBrain() {
  return useMutation({ mutationFn: (path: string) => revealBrain(path) })
}
