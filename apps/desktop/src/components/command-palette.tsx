import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { listCommands } from '../lib/commands/registry'
import type { CommandContext } from '../lib/commands/types'

/**
 * Minimal command palette over the registry: fuzzy-ish title/keyword filtering,
 * Enter runs the top result, Escape or backdrop click closes. (A richer cmdk
 * palette with record search lands in 03b.)
 */
export function CommandPalette({
  open,
  onClose,
  context,
}: {
  open: boolean
  onClose: () => void
  context: CommandContext
}): ReactNode {
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  const results = useMemo(() => {
    const all = listCommands()
    const needle = query.trim().toLowerCase()
    if (!needle) return all
    return all.filter(
      (command) =>
        command.title.toLowerCase().includes(needle) ||
        (command.keywords ?? []).some((keyword) => keyword.includes(needle)),
    )
  }, [query])

  if (!open) return null

  const run = (id: string): void => {
    const command = listCommands().find((candidate) => candidate.id === id)
    onClose()
    if (command) void command.run(context)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="w-[32rem] max-w-[90vw] overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose()
            if (event.key === 'Enter' && results[0]) run(results[0].id)
          }}
          placeholder="Search commands…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none"
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <li className="px-4 py-3 text-sm text-muted-foreground">No commands</li>
          ) : (
            results.map((command) => (
              <li key={command.id}>
                <button
                  type="button"
                  onClick={() => run(command.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-secondary"
                >
                  <span>{command.title}</span>
                  {command.keybinding ? (
                    <kbd className="font-mono text-[10px] text-muted-foreground">
                      {command.keybinding}
                    </kbd>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  )
}
