import { runCommand } from '../commands/registry'
import type { CommandContext } from '../commands/types'

type MenuCommandDispatch = (commandId: string) => boolean

let current: MenuCommandDispatch | null = null

const FALLBACK_CONTEXT: CommandContext = {
  navigate: () => {},
  back: () => {},
  forward: () => {},
  openPalette: () => {},
}

function runCommandAndLog(commandId: string, context: CommandContext): void {
  runCommand(commandId, context).catch((cause: unknown) => {
    console.error(`command failed: ${commandId}`, cause)
  })
}

/** Publish the active app-command dispatcher for native menu activations. */
export function setMenuCommandDispatch(dispatch: MenuCommandDispatch | null): void {
  current = dispatch
}

/** Forward a native menu activation to the mounted app shell, if one exists. */
export function dispatchMenuCommand(commandId: string): void {
  if (current !== null) {
    current(commandId)
    return
  }
  runCommandAndLog(commandId, FALLBACK_CONTEXT)
}

export { runCommandAndLog }
