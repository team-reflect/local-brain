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
 * swaps the Rust connection, so we seed `active-brain` with the returned info,
 * then *remove* every brain-scoped query (preserving the brain-picker queries)
 * so no stale old-brain rows can be served against the new database; the shell
 * also remounts (keyed by the active brain path) for a clean history, fetching
 * each surface fresh. Metadata-only edits (rename, color) just refresh the brain
 * lists. See {@link useApplyBrainSwitch} for the full rationale.
 */

export const BRAINS_KEY = ['brains'] as const
export const ACTIVE_BRAIN_KEY = ['active-brain'] as const

/**
 * Brain-picker queries that are *not* scoped to the contents of a single brain:
 * the cross-brain catalogue ({@link BRAINS_KEY}) and the active-brain pointer
 * ({@link ACTIVE_BRAIN_KEY}). Everything else (tasks, people, projects, …) reads
 * rows out of the open brain's database and must be dropped on a switch so stale
 * old-brain rows can never be rendered under the new brain.
 */
function isBrainPickerQuery(queryKey: readonly unknown[]): boolean {
  const root = queryKey[0]
  return root === BRAINS_KEY[0] || root === ACTIVE_BRAIN_KEY[0]
}

export function useBrains() {
  return useQuery({ queryKey: BRAINS_KEY, queryFn: listBrains })
}

export function useActiveBrain() {
  return useQuery({ queryKey: ACTIVE_BRAIN_KEY, queryFn: activeBrain })
}

/**
 * Apply a brain switch to the cache. The Rust side has already repointed the
 * live connection at the new brain, so any brain-scoped cache we still hold is
 * now stale — and `invalidateQueries()` alone only marks queries stale and keeps
 * serving the cached old-brain rows until background refetches finish, so the UI
 * can render old-brain tasks/people (with ids that may collide with the new
 * brain's) while reads and writes already hit the new database.
 *
 * So we (1) seed `active-brain` with the freshly returned info, which makes
 * {@link App} re-key its workspace on the new root immediately, (2) coherently
 * update the cached `brains` catalogue so the switched-to brain is the only one
 * flagged active right away — `invalidateQueries` alone only marks the list stale
 * and keeps serving the old snapshot until a refetch lands, which would briefly
 * mark the *old* brain active and list the new one under "other brains" — then
 * (3) *remove* every brain-scoped query so the remounted tree has no cache to
 * fall back on and must fetch each surface fresh against the now-active brain. We
 * deliberately preserve the brain-picker queries — `active-brain` (just seeded)
 * and the cross-brain `brains` catalogue (just reconciled) — and still invalidate
 * the catalogue so the authoritative last-opened order / schema version refetch
 * in the background without flickering the active flag.
 */
function useApplyBrainSwitch() {
  const queryClient = useQueryClient()
  return (brain: BrainInfo) => {
    queryClient.setQueryData(ACTIVE_BRAIN_KEY, brain)
    queryClient.setQueryData<BrainInfo[]>(BRAINS_KEY, (list) => seedActiveBrain(list, brain))
    queryClient.removeQueries({ predicate: (query) => !isBrainPickerQuery(query.queryKey) })
    void queryClient.invalidateQueries({ queryKey: BRAINS_KEY })
  }
}

/**
 * Reconcile a cached brain catalogue with a just-applied switch: the switched-to
 * `active` brain becomes the sole `isActive` entry and every other brain is
 * cleared, so a stale snapshot can't keep flagging the previous active brain. A
 * freshly created/opened brain absent from the list is prepended (the background
 * `BRAINS_KEY` refetch settles the authoritative order). Returns `list` untouched
 * when there's nothing cached yet — there's no snapshot to mislead the UI.
 */
function seedActiveBrain(
  list: BrainInfo[] | undefined,
  active: BrainInfo,
): BrainInfo[] | undefined {
  if (!list) return list
  let found = false
  const next = list.map((brain) => {
    if (brain.rootPath === active.rootPath) {
      found = true
      return active
    }
    return brain.isActive ? { ...brain, isActive: false } : brain
  })
  return found ? next : [active, ...next]
}

export function useOpenBrain() {
  const applySwitch = useApplyBrainSwitch()
  return useMutation({
    mutationFn: (rootPath: string) => openBrain(rootPath),
    onSuccess: applySwitch,
  })
}

export function useCreateBrain() {
  const applySwitch = useApplyBrainSwitch()
  return useMutation({
    mutationFn: (vars: { rootPath: string; name?: string }) => createBrain(vars.rootPath, vars.name),
    onSuccess: applySwitch,
  })
}

export function useRenameBrain() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { rootPath: string; name: string }) => renameBrain(vars.rootPath, vars.name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BRAINS_KEY })
      void queryClient.invalidateQueries({ queryKey: ACTIVE_BRAIN_KEY })
    },
  })
}

export function useSetBrainColor() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { rootPath: string; color: BrainColor }) =>
      setBrainColor(vars.rootPath, vars.color),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BRAINS_KEY })
      void queryClient.invalidateQueries({ queryKey: ACTIVE_BRAIN_KEY })
    },
  })
}

export function useForgetBrain() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (rootPath: string) => forgetBrain(rootPath),
    onSuccess: (list) => {
      queryClient.setQueryData(BRAINS_KEY, list)
      const active = list.find((brain) => brain.isActive) ?? null
      queryClient.setQueryData(ACTIVE_BRAIN_KEY, active)
      if (!active) {
        queryClient.removeQueries({ predicate: (query) => !isBrainPickerQuery(query.queryKey) })
      }
      void queryClient.invalidateQueries({ queryKey: BRAINS_KEY })
      void queryClient.invalidateQueries({ queryKey: ACTIVE_BRAIN_KEY })
    },
  })
}

export function useRevealBrain() {
  return useMutation({ mutationFn: (rootPath: string) => revealBrain(rootPath) })
}
