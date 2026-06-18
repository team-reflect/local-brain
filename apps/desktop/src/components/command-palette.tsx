import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { listCommands } from '../lib/commands/registry'
import type { CommandContext } from '../lib/commands/types'
import { useQuickSearch } from '../lib/queries'
import { routeForLinkedRecord } from './linked-records'

interface PaletteItem {
  key: string
  label: string
  hint: string | null
  run: () => void
}

const KIND_LABEL: Record<string, string> = {
  person: 'Person',
  organization: 'Organization',
  project: 'Project',
  task: 'Task',
  document: 'Document',
  interaction: 'Interaction',
}

/**
 * Command palette: fuzzy-ish command filtering plus live record search
 * (people, organizations, projects, tasks, documents, interactions). Arrow keys
 * move the selection across both groups, Enter runs/opens it, Escape closes.
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
  const [selected, setSelected] = useState(0)
  const search = useQuickSearch(open ? query : '')

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
    }
  }, [open])

  useEffect(() => {
    setSelected(0)
  }, [query])

  const commandItems = useMemo<PaletteItem[]>(() => {
    const needle = query.trim().toLowerCase()
    const all = listCommands()
    const matched = needle
      ? all.filter(
          (command) =>
            command.title.toLowerCase().includes(needle) ||
            (command.keywords ?? []).some((keyword) => keyword.includes(needle)),
        )
      : all
    return matched.map((command) => ({
      key: `command:${command.id}`,
      label: command.title,
      hint: command.keybinding ?? null,
      run: () => {
        onClose()
        void command.run(context)
      },
    }))
  }, [query, context, onClose])

  const recordItems = useMemo<PaletteItem[]>(() => {
    return (search.data ?? []).map((record) => {
      const route = routeForLinkedRecord(record)
      return {
        key: `record:${record.kind}:${record.id}`,
        label: record.title,
        hint: KIND_LABEL[record.kind] ?? record.kind,
        run: () => {
          onClose()
          if (route) context.navigate(route)
        },
      }
    })
  }, [search.data, context, onClose])

  const items = useMemo(() => [...commandItems, ...recordItems], [commandItems, recordItems])
  const activeIndex = Math.min(selected, Math.max(items.length - 1, 0))

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="w-[34rem] max-w-[90vw] overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onClose()
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              setSelected((index) => Math.min(index + 1, items.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setSelected((index) => Math.max(index - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              items[activeIndex]?.run()
            }
          }}
          placeholder="Search records or run a command…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none"
        />
        <div className="max-h-80 overflow-y-auto py-1">
          {items.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">No matches</p>
          ) : (
            <>
              {commandItems.length > 0 ? (
                <Group label="Commands" items={commandItems} startIndex={0} activeIndex={activeIndex} onSelect={setSelected} />
              ) : null}
              {recordItems.length > 0 ? (
                <Group
                  label="Records"
                  items={recordItems}
                  startIndex={commandItems.length}
                  activeIndex={activeIndex}
                  onSelect={setSelected}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Group({
  label,
  items,
  startIndex,
  activeIndex,
  onSelect,
}: {
  label: string
  items: PaletteItem[]
  startIndex: number
  activeIndex: number
  onSelect: (index: number) => void
}): ReactNode {
  return (
    <ul className="py-1">
      <li className="px-4 pb-1 pt-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </li>
      {items.map((item, offset) => {
        const index = startIndex + offset
        return (
          <li key={item.key}>
            <button
              type="button"
              onMouseMove={() => onSelect(index)}
              onClick={item.run}
              className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${
                index === activeIndex ? 'bg-secondary' : ''
              }`}
            >
              <span className="truncate">{item.label}</span>
              {item.hint ? (
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{item.hint}</span>
              ) : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
