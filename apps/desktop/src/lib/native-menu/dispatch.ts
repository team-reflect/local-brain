type MenuCommandDispatch = (commandId: string) => boolean

let current: MenuCommandDispatch | null = null

/** Publish the active app-command dispatcher for native menu activations. */
export function setMenuCommandDispatch(dispatch: MenuCommandDispatch | null): void {
  current = dispatch
}

/** Forward a native menu activation to the mounted app shell, if one exists. */
export function dispatchMenuCommand(commandId: string): void {
  current?.(commandId)
}
