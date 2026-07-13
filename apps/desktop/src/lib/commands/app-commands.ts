import { hasBridge, toggleDevtools } from '@local-brain/core'
import { registerCommands } from './registry'
import type { AppCommand } from './types'

/**
 * The launch command set: navigation to each surface, history, the palette, and
 * agent-oriented reporting entry points. Keybindings must be unique — the
 * `registry.test.ts` duplicate-binding test enforces it.
 */
export const APP_COMMANDS: readonly AppCommand[] = [
  { id: 'go.today', title: 'Go to Today', keywords: ['home', 'brief'], keybinding: 'Mod-1', run: (c) => c.navigate({ kind: 'today' }) },
  { id: 'go.tasks', title: 'Go to Tasks', keybinding: 'Mod-2', run: (c) => c.navigate({ kind: 'tasks' }) },
  { id: 'go.network', title: 'Go to Network', keywords: ['people', 'contacts'], keybinding: 'Mod-3', run: (c) => c.navigate({ kind: 'network', tab: 'graph' }) },
  { id: 'go.projects', title: 'Go to Projects', keybinding: 'Mod-4', run: (c) => c.navigate({ kind: 'projects' }) },
  { id: 'go.graph', title: 'Open Graph', keybinding: 'Mod-5', run: (c) => c.navigate({ kind: 'network', tab: 'graph' }) },
  { id: 'go.chat', title: 'Go to Chat', keywords: ['ask', 'question'], keybinding: 'Mod-6', run: (c) => c.navigate({ kind: 'chat' }) },
  { id: 'go.settings', title: 'Open Settings', keybinding: 'Mod-,', run: (c) => c.navigate({ kind: 'settings' }) },
  { id: 'go.brain', title: 'Brain settings', keywords: ['workspace', 'switch', 'brains', 'picker'], keybinding: 'Mod-Shift-B', run: (c) => c.navigate({ kind: 'settings', section: 'brain' }) },
  { id: 'palette.open', title: 'Open command palette', keybinding: 'Mod-k', run: (c) => c.openPalette() },
  {
    id: 'task.create',
    title: 'Create task',
    keywords: ['new task', 'add task', 'todo'],
    keybinding: 'Mod-Shift-T',
    run: (c) => c.openTaskCreate(),
  },
  { id: 'history.back', title: 'Back', keybinding: 'Mod-[', run: (c) => c.back() },
  { id: 'history.forward', title: 'Forward', keybinding: 'Mod-]', run: (c) => c.forward() },
  { id: 'report.daily', title: 'Run daily report', keybinding: 'Mod-Shift-R', run: (c) => c.navigate({ kind: 'today' }) },
  {
    id: 'dev.toggleDevtools',
    title: 'Developer tools',
    keywords: ['devtools', 'inspector', 'debug', 'console', 'web inspector'],
    keybinding: 'Mod-Shift-i',
    run: async () => {
      if (!hasBridge()) return
      try {
        await toggleDevtools()
      } catch {
        // Best effort: a debug affordance should never interrupt the app.
      }
    },
  },
]

/** Register the launch command set. Called once from `main.tsx`. */
export function registerAppCommands(): void {
  registerCommands(APP_COMMANDS)
}
