import type { AppCommand, CommandContext } from './types'

/**
 * The process-wide command registry. A flat id→command map with a collision
 * guard, so commands are defined once and addressed by id everywhere (palette,
 * shortcuts, later the CLI). `resetCommands` is a test seam.
 */
const commands = new Map<string, AppCommand>()

export function registerCommands(definitions: readonly AppCommand[]): void {
  for (const definition of definitions) {
    if (!definition.id) {
      throw new Error('command id is required')
    }
    if (!definition.title) {
      throw new Error(`command "${definition.id}" needs a title`)
    }
    if (commands.has(definition.id)) {
      throw new Error(`duplicate command id: ${definition.id}`)
    }
    commands.set(definition.id, definition)
  }
}

export function listCommands(): AppCommand[] {
  return [...commands.values()]
}

export function getCommand(id: string): AppCommand | undefined {
  return commands.get(id)
}

export function keybindingFor(id: string): string | undefined {
  return commands.get(id)?.keybinding
}

export async function runCommand(id: string, context: CommandContext): Promise<void> {
  const command = commands.get(id)
  if (!command) {
    throw new Error(`unknown command: ${id}`)
  }
  await command.run(context)
}

export function resetCommands(): void {
  commands.clear()
}
