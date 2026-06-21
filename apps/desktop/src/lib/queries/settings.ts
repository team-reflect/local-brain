import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  aiKeySecretName,
  apiKeyHint,
  cliInstall,
  cliStatus,
  cliUninstall,
  databasePath,
  getModelSettings,
  hardDeleteRecord,
  keychainDelete,
  keychainGet,
  keychainHas,
  keychainSet,
  rebuildSearchIndexes,
  skillInstall,
  skillStatus,
  skillUninstall,
  updateAiProvidersState,
  withAiProviderAdded,
  withAiProviderRemoved,
  type AiProviderConfig,
  type AiProviderId,
  type DeletableKind,
} from '@local-brain/core'

/**
 * Settings surface hooks (Plan 08/09): storage path, the model boundary, the
 * keychain-backed provider key, first-run onboarding, and hard-delete.
 */

export function useDatabasePath() {
  return useQuery({ queryKey: ['database-path'], queryFn: databasePath })
}

export function useCliStatus() {
  return useQuery({ queryKey: ['cli-status'], queryFn: cliStatus })
}

export function useInstallCli() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: cliInstall,
    onSuccess: (status) => queryClient.setQueryData(['cli-status'], status),
  })
}

export function useUninstallCli() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: cliUninstall,
    onSuccess: (status) => queryClient.setQueryData(['cli-status'], status),
  })
}

export function useSkillStatus() {
  return useQuery({ queryKey: ['skill-status'], queryFn: skillStatus })
}

export function useInstallSkill() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: skillInstall,
    onSuccess: (status) => queryClient.setQueryData(['skill-status'], status),
  })
}

export function useUninstallSkill() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: skillUninstall,
    onSuccess: (status) => queryClient.setQueryData(['skill-status'], status),
  })
}

export function useModelSettings() {
  return useQuery({ queryKey: ['model-settings'], queryFn: getModelSettings })
}

export function useKeychainHas(account: string) {
  return useQuery({ queryKey: ['keychain-has', account], queryFn: () => keychainHas(account) })
}

async function refreshModelQueries(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  const { refreshModelProvider } = await import('../ai/install-model')
  await refreshModelProvider()
  void queryClient.invalidateQueries({ queryKey: ['keychain-has'] })
  void queryClient.invalidateQueries({ queryKey: ['model-status'] })
  void queryClient.invalidateQueries({ queryKey: ['model-settings'] })
}

export interface NewAiProvider {
  provider: AiProviderId
  model: string
  apiKey: string
  isDefault: boolean
}

export function useAddAiProvider() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (draft: NewAiProvider) => {
      const id = crypto.randomUUID()
      const key = draft.apiKey.trim()
      const entry: AiProviderConfig = {
        id,
        provider: draft.provider,
        model: draft.model,
        keyHint: apiKeyHint(key),
      }
      const secretName = aiKeySecretName(id)
      await keychainSet(secretName, key)
      try {
        await updateAiProvidersState((state) => withAiProviderAdded(state, entry, draft.isDefault))
      } catch (error) {
        await keychainDelete(secretName).catch(() => {})
        throw error
      }
    },
    onSuccess: async () => {
      await refreshModelQueries(queryClient)
    },
  })
}

export function useRemoveAiProvider() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const secretName = aiKeySecretName(id)
      const priorSecret = await keychainGet(secretName).catch(() => null)
      await keychainDelete(secretName)
      try {
        await updateAiProvidersState((state) => withAiProviderRemoved(state, id))
      } catch (error) {
        if (priorSecret) await keychainSet(secretName, priorSecret).catch(() => {})
        throw error
      }
    },
    onSuccess: async () => {
      await refreshModelQueries(queryClient)
    },
  })
}

export function useMakeDefaultAiProvider() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await updateAiProvidersState((state) => ({
        providers: state.providers,
        defaultProviderId: id,
      }))
    },
    onSuccess: async () => {
      await refreshModelQueries(queryClient)
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
