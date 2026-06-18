import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_COMMANDS, registerAppCommands } from './app-commands'
import { eventMatchesBinding, parseBinding } from './keys'
import { getCommand, listCommands, registerCommands, resetCommands, runCommand } from './registry'
import type { CommandContext } from './types'

function context(): CommandContext {
  return { navigate: vi.fn(), back: vi.fn(), forward: vi.fn(), openPalette: vi.fn() }
}

describe('command registry', () => {
  beforeEach(() => resetCommands())

  it('rejects duplicate command ids', () => {
    registerCommands([{ id: 'a', title: 'A', run: () => {} }])
    expect(() => registerCommands([{ id: 'a', title: 'A again', run: () => {} }])).toThrow(
      /duplicate command id/,
    )
  })

  it('requires id and title', () => {
    expect(() => registerCommands([{ id: '', title: 'x', run: () => {} }])).toThrow()
    expect(() => registerCommands([{ id: 'x', title: '', run: () => {} }])).toThrow()
  })

  it('dispatches a command by id', async () => {
    const ctx = context()
    registerCommands([{ id: 'go', title: 'Go', run: (c) => c.openPalette() }])
    await runCommand('go', ctx)
    expect(ctx.openPalette).toHaveBeenCalledOnce()
  })

  it('registers the launch command set without collisions', () => {
    expect(() => registerAppCommands()).not.toThrow()
    expect(listCommands().length).toBe(APP_COMMANDS.length)
    expect(getCommand('go.today')).toBeDefined()
  })
})

describe('keybindings', () => {
  it('every app command has a unique keybinding (no duplicate accelerators)', () => {
    const bindings = APP_COMMANDS.flatMap((command) =>
      command.keybinding ? [command.keybinding] : [],
    )
    expect(new Set(bindings).size).toBe(bindings.length)
  })

  it('matches a Mod accelerator against a keyboard event', () => {
    const parsed = parseBinding('Mod-Shift-T')
    expect(parsed).toEqual({ mod: true, shift: true, alt: false, key: 't' })
    expect(
      eventMatchesBinding({ key: 'T', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false }, 'Mod-Shift-T'),
    ).toBe(true)
    expect(
      eventMatchesBinding({ key: 'k', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }, 'Mod-k'),
    ).toBe(true)
    expect(
      eventMatchesBinding({ key: 'k', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }, 'Mod-k'),
    ).toBe(false)
  })
})
