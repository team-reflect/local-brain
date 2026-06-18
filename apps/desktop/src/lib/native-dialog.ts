import { open } from '@tauri-apps/plugin-dialog'

/**
 * Thin wrappers over Tauri's native file dialog plugin for the brain picker.
 * A brain is a folder containing `brain.sqlite`, `assets/`, and support files,
 * so both create and open use the same directory picker. Isolated here so
 * components stay testable — the plugin reaches native code, so DOM tests mock
 * this module.
 */

async function pickBrainDirectory(title: string): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: true,
    title,
  })
  return typeof selected === 'string' ? selected : null
}

/** Native picker for an existing or new brain folder. Returns null on cancel. */
export function pickBrainToOpen(): Promise<string | null> {
  return pickBrainDirectory('Open another brain')
}

/** Native picker for a new brain folder. Returns null if the user cancels. */
export async function pickBrainToCreate(): Promise<string | null> {
  return pickBrainDirectory('New brain')
}
