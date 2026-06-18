import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  databasePath,
  getModelSettings,
  hardDeleteRecord,
  keychainDelete,
  keychainHas,
  keychainSet,
  rebuildSearchIndexes,
  setModelEnabled,
  type DeletableKind,
} from '@local-brain/core'

/**
 * Settings surface hooks (Plan 08/09): storage path, the model boundary, the
 * keychain-backed provider key, first-run onboarding, and hard-delete.
 */

export function useDatabasePath() {
  return useQuery({ queryKey: ['database-path'], queryFn: databasePath })
}

export function useModelSettings() {
  return useQuery({ queryKey: ['model-settings'], queryFn: getModelSettings })
}

export function useKeychainHas(account: string) {
  return useQuery({ queryKey: ['keychain-has', account], queryFn: () => keychainHas(account) })
}

export function useSetModelEnabled() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (enabled: boolean) => setModelEnabled(enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['model-settings'] })
      void queryClient.invalidateQueries({ queryKey: ['model-status'] })
    },
  })
}

/** Store/clear the provider key in the keychain, then re-register the provider. */
export function useSetProviderKey() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { account: string; secret: string | null }) => {
      if (vars.secret && vars.secret.trim()) await keychainSet(vars.account, vars.secret.trim())
      else await keychainDelete(vars.account)
      const { refreshModelProvider } = await import('../ai/install-model')
      await refreshModelProvider()
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['keychain-has'] })
      void queryClient.invalidateQueries({ queryKey: ['model-status'] })
      void queryClient.invalidateQueries({ queryKey: ['model-settings'] })
    },
  })
}

// First-run onboarding (Plan 09). Completion is once per app install, NOT per
// brain. Switching or creating a brain remounts the workspace keyed by the brain
// path, so a per-brain `settings` row would re-show onboarding on every new or
// different brain. We persist the flag in `localStorage`, which is scoped to the
// desktop webview origin (the install/profile) and shared across every brain DB.
const FIRST_RUN_KEY = 'firstRun.completed'

function readFirstRunCompleted(): boolean {
  try {
    return globalThis.localStorage?.getItem(FIRST_RUN_KEY) === 'true'
  } catch {
    // A locked-down or unavailable store means we cannot know; show onboarding.
    return false
  }
}

function writeFirstRunCompleted(): void {
  try {
    globalThis.localStorage?.setItem(FIRST_RUN_KEY, 'true')
  } catch {
    // Best effort: if the store rejects the write, onboarding simply reappears.
  }
}

export function useFirstRun() {
  return useQuery({
    queryKey: ['first-run'],
    queryFn: () => readFirstRunCompleted(),
  })
}

export function useCompleteFirstRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => {
      writeFirstRunCompleted()
      return Promise.resolve(true)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['first-run'] }),
  })
}

/** Hard-delete a record (with cascade) and rebuild derived indexes. */
export function useHardDelete() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { kind: DeletableKind; id: string }) => {
      await hardDeleteRecord(vars.kind, vars.id)
      await rebuildSearchIndexes()
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}
