import { registerCommands } from './registry'
import type { AppCommand } from './types'

/**
 * The launch command set: navigation to each surface, history, the palette, and
 * record-creation entry points (the new-record flows themselves arrive in 03b;
 * for now they route to the relevant surface). Keybindings must be unique — the
 * `registry.test.ts` duplicate-binding test enforces it.
 */
export const APP_COMMANDS: readonly AppCommand[] = [
  { id: 'go.today', title: 'Go to Today', keywords: ['home', 'brief'], keybinding: 'Mod-1', run: (c) => c.navigate({ kind: 'today' }) },
  { id: 'go.tasks', title: 'Go to Tasks', keybinding: 'Mod-2', run: (c) => c.navigate({ kind: 'tasks' }) },
  { id: 'go.network', title: 'Go to Network', keywords: ['people', 'contacts'], keybinding: 'Mod-3', run: (c) => c.navigate({ kind: 'network', tab: 'people' }) },
  { id: 'go.projects', title: 'Go to Projects', keybinding: 'Mod-4', run: (c) => c.navigate({ kind: 'projects' }) },
  { id: 'go.graph', title: 'Open Graph', keybinding: 'Mod-5', run: (c) => c.navigate({ kind: 'graph' }) },
  { id: 'go.ask', title: 'Open Ask', keywords: ['chat', 'search'], keybinding: 'Mod-6', run: (c) => c.navigate({ kind: 'ask' }) },
  { id: 'go.settings', title: 'Open Settings', keybinding: 'Mod-,', run: (c) => c.navigate({ kind: 'settings' }) },
  { id: 'palette.open', title: 'Open command palette', keybinding: 'Mod-k', run: (c) => c.openPalette() },
  { id: 'history.back', title: 'Back', keybinding: 'Mod-[', run: (c) => c.back() },
  { id: 'history.forward', title: 'Forward', keybinding: 'Mod-]', run: (c) => c.forward() },
  { id: 'new.task', title: 'New task', keybinding: 'Mod-Shift-T', run: (c) => c.navigate({ kind: 'tasks' }) },
  { id: 'new.document', title: 'New document', keywords: ['import', 'paste', 'note'], keybinding: 'Mod-Shift-D', run: (c) => c.openAdd('document') },
  { id: 'new.interaction', title: 'New interaction', keywords: ['meeting', 'transcript', 'call'], keybinding: 'Mod-Shift-I', run: (c) => c.openAdd('interaction') },
  { id: 'report.daily', title: 'Run daily report', keybinding: 'Mod-Shift-R', run: (c) => c.navigate({ kind: 'today' }) },
]

/** Register the launch command set. Called once from `main.tsx`. */
export function registerAppCommands(): void {
  registerCommands(APP_COMMANDS)
}
