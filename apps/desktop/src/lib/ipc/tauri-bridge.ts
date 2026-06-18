import { invoke } from '@tauri-apps/api/core'
import { setBridge } from '@local-brain/core'

/**
 * Wire the Tauri `invoke` channel into the core IPC bridge. This is the only
 * place in the app that imports `@tauri-apps/api`; everything else goes through
 * the typed `call()` boundary in `@local-brain/core`.
 */
export function installTauriBridge(): void {
  setBridge({
    invoke: (command, args) => invoke(command, args),
  })
}
