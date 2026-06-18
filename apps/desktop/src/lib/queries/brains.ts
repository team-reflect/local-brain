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
  type BrainInfo,
} from '@local-brain/core'

/**
 * Hooks for the top-level brain picker. Switching the active brain (open/create)
 * swaps the Rust connection, so we seed `active-brain` with the returned info and
 * then invalidate the entire query cache to refetch every surface against the
 * newly active brain; the shell also remounts (keyed by the active brain path)
 * for a clean history. Metadata-only edits (rename, color) just refresh the brain
 * lists.
 */

export const BRAINS_KEY = ['brains'] as const
export const ACTIVE_BRAIN_KEY = ['active-brain'] as const

export function useBrains() {
  return useQuery({ queryKey: BRAINS_KEY, queryFn: listBrains })
}

export function useActiveBrain() {
  return useQuery({ queryKey: ACTIVE_BRAIN_KEY, queryFn: activeBrain })
}

/**
 * Apply a brain switch to the cache. We seed `active-brain` with the freshly
 * returned info *before* invalidating, so {@link App} immediately re-keys its
 * workspace on the new path; only then do we invalidate everything else to
 * refetch every surface against the now-active brain. Seeding first closes the
 * window where other invalidated queries return the new brain's data while the
 * workspace is still mounted under the previous path.
 */
function useApplyBrainSwitch() {
  const queryClient = useQueryClient()
  return (brain: BrainInfo) => {
    queryClient.setQueryData(ACTIVE_BRAIN_KEY, brain)
    void queryClient.invalidateQueries()
  }
}

export function useOpenBrain() {
  const applySwitch = useApplyBrainSwitch()
  return useMutation({
    mutationFn: (path: string) => openBrain(path),
    onSuccess: applySwitch,
  })
}

export function useCreateBrain() {
  const applySwitch = useApplyBrainSwitch()
  return useMutation({
    mutationFn: (vars: { path: string; name?: string }) => createBrain(vars.path, vars.name),
    onSuccess: applySwitch,
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
