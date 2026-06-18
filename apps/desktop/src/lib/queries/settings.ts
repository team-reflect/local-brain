import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  assembleExport,
  createBackup,
  databasePath,
  defaultBackupPath,
  defaultExportPath,
  exportCounts,
  exportToFile,
  getModelSettings,
  getSetting,
  hardDeleteRecord,
  keychainDelete,
  keychainHas,
  keychainSet,
  rebuildSearchIndexes,
  setModelEnabled,
  setSetting,
  type DeletableKind,
} from '@local-brain/core'

/**
 * Settings surface hooks (Plan 08/09): storage path, the model boundary,
 * backup/export, the keychain-backed provider key, first-run onboarding, and the
 * destructive hard-delete.
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

export function useExportSummary() {
  return useQuery({ queryKey: ['export-summary'], queryFn: () => assembleExport().then(exportCounts) })
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

export function useCreateBackup() {
  return useMutation({ mutationFn: (dest: string) => createBackup(dest) })
}

export function useExportJson() {
  return useMutation({ mutationFn: (dest: string) => exportToFile(dest) })
}

export function useDefaultPaths(stamp: string) {
  return useQuery({
    queryKey: ['default-paths', stamp],
    queryFn: async () => ({
      backup: await defaultBackupPath(stamp),
      export: await defaultExportPath(stamp),
    }),
  })
}

// First-run onboarding (Plan 09). Tracked by a settings flag so it shows once.
const FIRST_RUN_KEY = 'firstRun.completed'

export function useFirstRun() {
  return useQuery({
    queryKey: ['first-run'],
    queryFn: () => getSetting<boolean>(FIRST_RUN_KEY, false),
  })
}

export function useCompleteFirstRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => setSetting(FIRST_RUN_KEY, true),
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
