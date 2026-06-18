import { useEffect } from 'react'
import { eventMatchesBinding } from './keys'
import { blockingModalOpen } from './modal-guard'
import { listCommands } from './registry'
import type { CommandContext } from './types'

/**
 * Bind global keyboard shortcuts once. Each keydown is matched against the
 * registered commands' keybindings; the first match runs and the event is
 * consumed. Typing in inputs/textareas is left alone (except ⌘K, which should
 * always open the palette).
 */
export function useAppShortcuts(context: CommandContext): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // A blocking modal (e.g. first-run onboarding) owns the screen: suppress
      // every global shortcut, including ⌘K, while it is open.
      if (blockingModalOpen()) return
      const target = event.target as HTMLElement | null
      const typing =
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)

      for (const command of listCommands()) {
        if (command.keybinding === undefined) continue
        if (!eventMatchesBinding(event, command.keybinding)) continue
        if (typing && command.id !== 'palette.open') return
        event.preventDefault()
        void command.run(context)
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [context])
}
