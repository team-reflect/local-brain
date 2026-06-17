import type { Route } from '../../routing/route'
import type { AddRecordType } from '../../components/add-record-dialog'

/** What a command can do to the app when it runs. */
export interface CommandContext {
  navigate: (route: Route) => void
  back: () => void
  forward: () => void
  openPalette: () => void
  /** Open the add-record dialog for a document or interaction. */
  openAdd: (type: AddRecordType) => void
}

/**
 * A globally addressable action. `id` is stable (used by the palette and, later,
 * the CLI/skills); `keybinding` is an optional `Mod-…` accelerator.
 */
export interface AppCommand {
  id: string
  title: string
  keywords?: string[]
  keybinding?: string
  run: (context: CommandContext) => void | Promise<void>
}
