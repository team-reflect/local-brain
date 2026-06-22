import type { AppError } from '../errors'

/**
 * The minimal native-IPC surface `packages/core` depends on. The desktop app
 * installs a concrete bridge over `@tauri-apps/api` (see
 * `apps/desktop/src/lib/ipc/tauri-bridge.ts`); tests install a fake. Core stays
 * platform-agnostic and never imports `@tauri-apps/*` directly.
 */
export interface IpcBridge {
  invoke(command: string, args: Record<string, unknown>): Promise<unknown>
}

let installed: IpcBridge | null = null

/** Install the process-wide IPC bridge. Called once at app/CLI startup. */
export function setBridge(bridge: IpcBridge | null): void {
  installed = bridge
}

/** True when a native IPC bridge is available. */
export function hasBridge(): boolean {
  return installed !== null
}

/** The installed bridge, or an `unknown` AppError if startup never wired one up. */
export function getBridge(): IpcBridge {
  if (installed === null) {
    const error: AppError = {
      kind: 'unknown',
      message: 'IPC bridge is not installed; call setBridge() at startup',
    }
    throw error
  }
  return installed
}
