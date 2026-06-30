import { describe, expect, it } from 'vitest'
import { APP_COMMANDS } from '../commands/app-commands'
import { bindingToAccelerator } from './accelerator'
import { appMenuLayout, menuItemOptions } from './menu'

function referencedCommandIds(): string[] {
  return appMenuLayout().flatMap((submenu) =>
    submenu.entries.flatMap((entry) => (entry.kind === 'command' ? [entry.commandId] : [])),
  )
}

describe('native app menu', () => {
  it('references only registered command ids', () => {
    const known = new Set(APP_COMMANDS.map((command) => command.id))
    for (const commandId of referencedCommandIds()) {
      expect(known).toContain(commandId)
    }
  })

  it('surfaces Web Inspector access in the View menu', () => {
    const view = appMenuLayout().find((submenu) => submenu.text === 'View')
    expect(view?.entries).toContainEqual({ kind: 'command', commandId: 'dev.toggleDevtools' })
    expect(menuItemOptions('dev.toggleDevtools')).toMatchObject({
      id: 'dev.toggleDevtools',
      text: 'Developer tools',
      accelerator: 'CmdOrCtrl+Shift+I',
    })
  })

  it('converts command bindings to native accelerators', () => {
    expect(bindingToAccelerator('Mod-k')).toBe('CmdOrCtrl+K')
    expect(bindingToAccelerator('Mod-,')).toBe('CmdOrCtrl+,')
  })
})
