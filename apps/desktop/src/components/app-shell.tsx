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
  Users,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { keycapClass } from '../lib/ui'
import { useAppShortcuts } from '../lib/commands/use-shortcuts'
import type { CommandContext } from '../lib/commands/types'
import { sectionForRoute, type Route } from '../routing/route'
import { useRouter } from '../routing/router'
import { AddRecordDialog, type AddRecordType } from './add-record-dialog'
import { BrainSwitcher } from './brain-switcher'
import { CommandPalette } from './command-palette'
import { FirstRun } from './first-run'
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
  { section: 'network', label: 'Network', icon: Users, route: { kind: 'network', tab: 'graph' } },
  { section: 'projects', label: 'Projects', icon: FolderKanban, route: { kind: 'projects' } },
  { section: 'ask', label: 'Ask', icon: MessageSquare, route: { kind: 'ask' } },
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
  const settingsActive = activeSection === 'settings'

  return (
    <div className="flex h-full">
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-border bg-[hsl(var(--lb-sidebar))] py-5">
        <BrainSwitcher />
        <div className="flex items-center justify-end gap-1 px-4 pb-3">
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
        </div>
        <nav className="flex flex-col gap-1 px-4 py-2">
          {NAV.map((item) => {
            const Icon = item.icon
            const active = item.section === activeSection
            return (
              <button
                key={item.section}
                type="button"
                onClick={() => navigate(item.route)}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-medium transition-colors',
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
        <div className="mt-auto flex items-center gap-1 px-4 pt-4">
          <button
            type="button"
            onClick={() => openAdd('document')}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium text-[hsl(var(--lb-ink-2))] transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <Plus className="size-4 shrink-0 text-muted-foreground" />
            Add record
          </button>
          <button
            type="button"
            onClick={() => navigate({ kind: 'settings' })}
            aria-label="Settings"
            aria-current={settingsActive ? 'page' : undefined}
            title="Settings"
            className={cn(
              'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground',
              settingsActive ? 'bg-secondary text-foreground' : null,
            )}
          >
            <Settings className={cn('size-4', settingsActive ? 'text-primary' : 'text-muted-foreground')} />
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="flex h-12 items-center justify-center border-b border-border px-4">
          <button
            type="button"
            onClick={openPalette}
            aria-label="Search or run a command"
            className="flex h-8 w-[min(760px,100%)] items-center gap-2 rounded-md border border-input bg-card px-3 text-xs text-muted-foreground shadow-sm transition-colors hover:text-foreground"
          >
            <Search className="size-3.5" />
            <span className="flex-1 truncate text-left">Search anything…</span>
            <kbd className={keycapClass}>⌘K</kbd>
          </button>
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
      <FirstRun />
    </div>
  )
}
