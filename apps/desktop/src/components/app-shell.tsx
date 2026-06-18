import { useCallback, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  ListTodo,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Share2,
  Users,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { keycapClass } from '../lib/ui'
import { Button } from './button'
import { useAppShortcuts } from '../lib/commands/use-shortcuts'
import type { CommandContext } from '../lib/commands/types'
import { sectionForRoute, type Route } from '../routing/route'
import { useRouter } from '../routing/router'
import { AddRecordDialog, type AddRecordType } from './add-record-dialog'
import { CommandPalette } from './command-palette'
import { RouteContent } from './route-content'

interface NavItem {
  section: string
  label: string
  icon: ComponentType<{ className?: string }>
  route: Route
}

const NAV: readonly NavItem[] = [
  { section: 'today', label: 'Today', icon: CalendarDays, route: { kind: 'today' } },
  { section: 'tasks', label: 'Tasks', icon: ListTodo, route: { kind: 'tasks' } },
  { section: 'network', label: 'Network', icon: Users, route: { kind: 'network', tab: 'people' } },
  { section: 'projects', label: 'Projects', icon: FolderKanban, route: { kind: 'projects' } },
  { section: 'graph', label: 'Graph', icon: Share2, route: { kind: 'graph' } },
  { section: 'ask', label: 'Ask', icon: MessageSquare, route: { kind: 'ask' } },
  { section: 'settings', label: 'Settings', icon: Settings, route: { kind: 'settings' } },
]

export function AppShell(): ReactNode {
  const { route, navigate, back, forward, canBack, canForward } = useRouter()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [addState, setAddState] = useState<{ open: boolean; type: AddRecordType }>({
    open: false,
    type: 'document',
  })
  const activeSection = sectionForRoute(route)

  const openPalette = useCallback(() => setPaletteOpen(true), [])
  const openAdd = useCallback((type: AddRecordType) => setAddState({ open: true, type }), [])
  const context = useMemo<CommandContext>(
    () => ({ navigate, back, forward, openPalette, openAdd }),
    [navigate, back, forward, openPalette, openAdd],
  )
  useAppShortcuts(context)

  return (
    <div className="flex h-full">
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-border bg-[hsl(var(--lb-sidebar))]">
        <div className="flex items-center gap-2 px-4 pb-2 pt-4">
          <span className="size-2.5 rounded-[5px] bg-primary" />
          <span className="text-sm font-semibold tracking-tight text-foreground">Local Brain</span>
        </div>
        <div className="px-3 pb-1">
          <button
            type="button"
            onClick={openPalette}
            className="flex w-full items-center gap-2 rounded-md border border-input bg-card px-2.5 py-1.5 text-left text-xs text-muted-foreground shadow-sm transition-colors hover:text-foreground"
          >
            <Search className="size-3.5 shrink-0" />
            <span className="flex-1 truncate">Search anything…</span>
            <kbd className={keycapClass}>⌘K</kbd>
          </button>
        </div>
        <nav className="flex flex-col gap-0.5 px-3 py-1">
          {NAV.map((item) => {
            const Icon = item.icon
            const active = item.section === activeSection
            return (
              <button
                key={item.section}
                type="button"
                onClick={() => navigate(item.route)}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm font-medium transition-colors',
                  active
                    ? 'bg-secondary text-foreground'
                    : 'text-[hsl(var(--lb-ink-2))] hover:bg-secondary/60',
                )}
              >
                <Icon className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
                {item.label}
              </button>
            )
          })}
        </nav>
        <div className="mt-auto px-3 pb-3">
          <button
            type="button"
            onClick={() => openAdd('document')}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm font-medium text-[hsl(var(--lb-ink-2))] transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <Plus className="size-4 shrink-0 text-muted-foreground" />
            Add record
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="flex h-12 items-center gap-1.5 border-b border-border px-4">
          <button
            type="button"
            onClick={back}
            disabled={!canBack}
            aria-label="Back"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={forward}
            disabled={!canForward}
            aria-label="Forward"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ChevronRight className="size-4" />
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={openPalette}
            aria-label="Search or run a command"
            className="flex items-center gap-2 rounded-md border border-input bg-card px-2.5 py-1.5 text-xs text-muted-foreground shadow-sm transition-colors hover:text-foreground"
          >
            <Search className="size-3.5" />
            <span>Search</span>
            <kbd className={keycapClass}>⌘K</kbd>
          </button>
          <Button size="sm" onClick={() => openAdd('document')} aria-label="Add a record">
            <Plus className="size-3.5" />
            Add
          </Button>
        </header>
        <main className="flex-1 overflow-y-auto px-7 py-6">
          <RouteContent route={route} />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} context={context} />
      <AddRecordDialog
        open={addState.open}
        initialType={addState.type}
        onClose={() => setAddState((current) => ({ ...current, open: false }))}
      />
    </div>
  )
}
