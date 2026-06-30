import { isTauri } from '@tauri-apps/api/core'
import {
  Menu,
  Submenu,
  type MenuItemOptions,
  type PredefinedMenuItemOptions,
} from '@tauri-apps/api/menu'
import { APP_COMMANDS } from '../commands/app-commands'
import { bindingToAccelerator } from './accelerator'
import { dispatchMenuCommand } from './dispatch'

type PredefinedItem = PredefinedMenuItemOptions['item']

export type AppMenuEntry =
  | { kind: 'command'; commandId: string; text?: string }
  | { kind: 'predefined'; item: PredefinedItem; text?: string }

export interface AppSubmenuLayout {
  text: string
  nsAppRole?: 'windows' | 'help'
  entries: AppMenuEntry[]
}

function command(commandId: string, text?: string): AppMenuEntry {
  return text === undefined ? { kind: 'command', commandId } : { kind: 'command', commandId, text }
}

function predefined(item: PredefinedItem, text?: string): AppMenuEntry {
  return text === undefined ? { kind: 'predefined', item } : { kind: 'predefined', item, text }
}

function separator(): AppMenuEntry {
  return predefined('Separator')
}

/** Pure app-menu structure so tests can assert command ids and accelerators. */
export function appMenuLayout(): AppSubmenuLayout[] {
  return [
    {
      text: 'Local Brain',
      entries: [
        predefined({ About: null }, 'About Local Brain'),
        separator(),
        command('go.settings', 'Settings...'),
        separator(),
        predefined('Services'),
        separator(),
        predefined('Hide', 'Hide Local Brain'),
        predefined('HideOthers'),
        predefined('ShowAll'),
        separator(),
        predefined('Quit', 'Quit Local Brain'),
      ],
    },
    {
      text: 'File',
      entries: [predefined('CloseWindow')],
    },
    {
      text: 'Edit',
      entries: [
        predefined('Undo'),
        predefined('Redo'),
        separator(),
        predefined('Cut'),
        predefined('Copy'),
        predefined('Paste'),
        predefined('SelectAll'),
      ],
    },
    {
      text: 'View',
      entries: [
        command('palette.open', 'Search...'),
        command('go.today'),
        command('go.tasks'),
        command('go.network'),
        command('go.projects'),
        command('go.chat'),
        separator(),
        command('history.back'),
        command('history.forward'),
        separator(),
        command('dev.toggleDevtools'),
      ],
    },
    {
      text: 'Window',
      nsAppRole: 'windows',
      entries: [
        predefined('Minimize'),
        predefined('Maximize', 'Zoom'),
        separator(),
        predefined('BringAllToFront'),
      ],
    },
    {
      text: 'Help',
      nsAppRole: 'help',
      entries: [],
    },
  ]
}

export function menuItemOptions(commandId: string, text?: string): MenuItemOptions {
  const appCommand = APP_COMMANDS.find((candidate) => candidate.id === commandId)
  if (!appCommand) {
    throw new Error(`native menu references unknown command: ${commandId}`)
  }
  const accelerator = appCommand.keybinding
    ? bindingToAccelerator(appCommand.keybinding)
    : undefined
  return {
    id: appCommand.id,
    text: text ?? appCommand.title,
    ...(accelerator === undefined ? {} : { accelerator }),
    action: dispatchMenuCommand,
  }
}

function entryOptions(entry: AppMenuEntry): MenuItemOptions | PredefinedMenuItemOptions {
  return entry.kind === 'command'
    ? menuItemOptions(entry.commandId, entry.text)
    : { item: entry.item, ...(entry.text === undefined ? {} : { text: entry.text }) }
}

function isMacosDesktop(): boolean {
  return (
    isTauri() &&
    typeof navigator !== 'undefined' &&
    navigator.userAgent.includes('Macintosh') &&
    navigator.maxTouchPoints === 0
  )
}

/** Install the native macOS application menu, replacing Tauri's default menu. */
export async function installNativeMenu(): Promise<void> {
  if (!isMacosDesktop()) return

  const submenus = await Promise.all(
    appMenuLayout().map(async (layout) => {
      const submenu = await Submenu.new({
        text: layout.text,
        items: layout.entries.map(entryOptions),
      })
      if (layout.nsAppRole === 'windows') {
        await submenu.setAsWindowsMenuForNSApp()
      } else if (layout.nsAppRole === 'help') {
        await submenu.setAsHelpMenuForNSApp()
      }
      return submenu
    }),
  )
  const menu = await Menu.new({ items: submenus })
  await menu.setAsAppMenu()
}
