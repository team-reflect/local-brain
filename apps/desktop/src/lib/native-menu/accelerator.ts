const ACCELERATOR_MODIFIERS: Record<string, string> = {
  mod: 'CmdOrCtrl',
  shift: 'Shift',
  alt: 'Alt',
  ctrl: 'Ctrl',
  meta: 'Cmd',
}

/**
 * Convert a command-registry binding like `Mod-Shift-i` to a Tauri/muda
 * accelerator like `CmdOrCtrl+Shift+I`.
 */
export function bindingToAccelerator(binding: string): string {
  const parts = binding.endsWith('-')
    ? [...binding.slice(0, -1).split('-').filter(Boolean), '-']
    : binding.split('-')

  return parts
    .map((part, index) => {
      const lower = part.toLowerCase()
      if (index < parts.length - 1 && lower in ACCELERATOR_MODIFIERS) {
        return ACCELERATOR_MODIFIERS[lower]
      }
      return part.length === 1 ? part.toUpperCase() : part
    })
    .join('+')
}
