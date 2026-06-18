import { open, save } from '@tauri-apps/plugin-dialog'

/**
 * Thin wrappers over Tauri's native file dialog plugin for the brain picker.
 * A brain is one `.sqlite` file, so "open" uses a file-open dialog and "create"
 * uses a save dialog (the OS handles overwrite confirmation; Rust still rejects
 * an existing path). Isolated here so components stay testable — the plugin's
 * `open`/`save` reach native code, so DOM tests mock this module.
 */

const BRAIN_FILTERS = [{ name: 'Brain database', extensions: ['sqlite'] }]

/** Native picker for an existing brain file. Returns null if the user cancels. */
export async function pickBrainToOpen(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    title: 'Open another brain',
    filters: BRAIN_FILTERS,
  })
  return typeof selected === 'string' ? selected : null
}

/** Native save dialog for a new brain file. Returns null if the user cancels. */
export async function pickBrainToCreate(): Promise<string | null> {
  const selected = await save({
    title: 'New brain',
    defaultPath: 'brain.sqlite',
    filters: BRAIN_FILTERS,
  })
  return selected ?? null
}
