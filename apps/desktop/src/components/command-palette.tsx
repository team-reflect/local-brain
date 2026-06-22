import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { VisuallyHidden } from 'radix-ui'
import { listCommands } from '../lib/commands/registry'
import type { CommandContext } from '../lib/commands/types'
import { useGlobalSearch } from '../lib/queries'
import { routeForRecord } from '../routing/route'
import { cn } from '../lib/utils'
import type { SearchHit } from '@local-brain/core'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './ui/command'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

interface PaletteItem {
  key: string
  label: string
  hint: string | null
  detail: string | null
  snippet: string | null
  run: () => void
}

const KIND_LABEL: Record<string, string> = {
  person: 'Person',
  organization: 'Organization',
  project: 'Project',
  task: 'Task',
  document: 'Document',
  interaction: 'Interaction',
  asset: 'Asset',
}

/**
 * Command palette: one minimal surface for full-text record search and command
 * execution. Normal queries show ranked record hits first; `>` filters to
 * commands only.
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
  const [selectedValue, setSelectedValue] = useState('')
  const trimmed = query.trim()
  const commandsOnly = trimmed.startsWith('>')
  const search = useGlobalSearch(open && !commandsOnly ? query : '')

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedValue('')
    }
  }, [open])

  useEffect(() => {
    setSelectedValue('')
  }, [query])

  const commandItems = useMemo<PaletteItem[]>(() => {
    const needle = (commandsOnly ? trimmed.slice(1) : trimmed).trim().toLowerCase()
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
      detail: null,
      snippet: null,
      run: () => {
        onClose()
        void command.run(context)
      },
    }))
  }, [commandsOnly, trimmed, context, onClose])

  const recordItems = useMemo<PaletteItem[]>(() => {
    return (search.data ?? []).map((hit) => {
      const route = routeForRecord(hit.kind, hit.id)
      return {
        key: `record:${hit.kind}:${hit.id}`,
        label: hit.title,
        hint: KIND_LABEL[hit.kind] ?? hit.kind,
        detail: recordDetail(hit),
        snippet: hit.snippet,
        run: () => {
          onClose()
          if (route) context.navigate(route)
        },
      }
    })
  }, [search.data, context, onClose])

  const items = useMemo(() => {
    if (commandsOnly) return commandItems
    if (trimmed.length === 0) return commandItems
    return [...recordItems, ...commandItems]
  }, [commandsOnly, trimmed.length, recordItems, commandItems])
  const itemKey = items.map((item) => item.key).join('\n')
  const waitingForRecords =
    !commandsOnly && trimmed.length > 0 && recordItems.length === 0 && search.isFetching

  useEffect(() => {
    setSelectedValue((value) => {
      if (!open || items.length === 0) return ''
      const hasSelection = items.some((item) => item.key === value)
      if (!hasSelection) return items[0]!.key
      if (!commandsOnly && trimmed.length > 0 && recordItems.length > 0 && value.startsWith('command:')) {
        return recordItems[0]!.key
      }
      return value
    })
  }, [open, itemKey, commandsOnly, trimmed.length, recordItems, items])

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="w-[36rem]" aria-label="Search records or run a command">
        <VisuallyHidden.Root>
          <DialogTitle>Command palette</DialogTitle>
        </VisuallyHidden.Root>
        <Command shouldFilter={false} value={selectedValue} onValueChange={setSelectedValue}>
          <div className="flex items-center gap-2.5 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <CommandInput
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Search records or run a command…"
            />
          </div>
          <CommandList>
            {items.length === 0 && !waitingForRecords ? <CommandEmpty>No matches</CommandEmpty> : null}
            {!commandsOnly && trimmed.length > 0 && recordItems.length > 0 ? (
              <Group label="Records" items={recordItems} />
            ) : null}
            {commandItems.length > 0 ? <Group label="Commands" items={commandItems} /> : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function Group({
  label,
  items,
}: {
  label: string
  items: PaletteItem[]
}): ReactNode {
  return (
    <CommandGroup heading={label}>
      {items.map((item) => (
        <CommandItem key={item.key} value={item.key} onSelect={item.run}>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{item.label}</span>
              {item.detail ? (
                <span className="truncate text-xs text-muted-foreground">{item.detail}</span>
              ) : null}
            </span>
            {item.snippet ? <Snippet text={item.snippet} /> : null}
          </span>
          {item.hint ? (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{item.hint}</span>
          ) : null}
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

function recordDetail(hit: SearchHit): string | null {
  const kind = KIND_LABEL[hit.kind] ?? hit.kind
  return hit.subtitle ? `${kind} · ${hit.subtitle}` : kind
}

function Snippet({ text }: { text: string }): ReactNode {
  return (
    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
      {text.split(/(\[[^\]]+\])/g).map((part, index) => {
        const highlighted = part.startsWith('[') && part.endsWith(']')
        const content = highlighted ? part.slice(1, -1) : part
        return (
          <span
            key={`${part}:${index}`}
            className={cn(highlighted && 'rounded-sm bg-accent/15 px-0.5 text-foreground')}
          >
            {content}
          </span>
        )
      })}
    </span>
  )
}
