/**
 * Keybinding parsing. Bindings are written `Mod-…` strings (Reflect Open's
 * convention), where `Mod` is ⌘ on macOS and Ctrl elsewhere. The final segment
 * is the key (compared case-insensitively against `KeyboardEvent.key`).
 */
export interface ParsedBinding {
  mod: boolean
  shift: boolean
  alt: boolean
  key: string
}

export function parseBinding(binding: string): ParsedBinding {
  const parts = binding.split('-')
  const key = (parts[parts.length - 1] ?? '').toLowerCase()
  return {
    mod: parts.includes('Mod'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    key,
  }
}

export function eventMatchesBinding(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  binding: string,
): boolean {
  const parsed = parseBinding(binding)
  const mod = event.metaKey || event.ctrlKey
  return (
    parsed.mod === mod &&
    parsed.shift === event.shiftKey &&
    parsed.alt === event.altKey &&
    event.key.toLowerCase() === parsed.key
  )
}
