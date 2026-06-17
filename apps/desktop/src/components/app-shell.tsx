import { useCallback, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  ListTodo,
  MessageSquare,
  Search,
  Settings,
  Share2,
  Users,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { useAppShortcuts } from '../lib/commands/use-shortcuts'
import type { CommandContext } from '../lib/commands/types'
import { sectionForRoute, type Route } from '../routing/route'
import { useRouter } from '../routing/router'
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
  const activeSection = sectionForRoute(route)

  const openPalette = useCallback(() => setPaletteOpen(true), [])
  const context = useMemo<CommandContext>(
    () => ({ navigate, back, forward, openPalette }),
    [navigate, back, forward, openPalette],
  )
  useAppShortcuts(context)

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-[hsl(var(--lb-sidebar))]">
        <div className="flex items-center gap-2 px-4 py-3.5">
          <span className="size-2 rounded-full bg-primary" />
          <span className="font-serif text-sm text-foreground">Local Brain</span>
        </div>
        <nav className="flex flex-col gap-0.5 px-2 py-1">
          {NAV.map((item) => {
            const Icon = item.icon
            const active = item.section === activeSection
            return (
              <button
                key={item.section}
                type="button"
                onClick={() => navigate(item.route)}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                  active
                    ? 'bg-secondary text-foreground'
                    : 'text-[hsl(var(--lb-ink-2))] hover:bg-secondary/60',
                )}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                {item.label}
              </button>
            )
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-4 py-2">
          <button
            type="button"
            onClick={back}
            disabled={!canBack}
            aria-label="Back"
            className="rounded p-1 text-muted-foreground hover:bg-secondary disabled:opacity-40"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={forward}
            disabled={!canForward}
            aria-label="Forward"
            className="rounded p-1 text-muted-foreground hover:bg-secondary disabled:opacity-40"
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            type="button"
            onClick={openPalette}
            className="ml-1 flex flex-1 items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-secondary/50"
          >
            <Search className="size-3.5" />
            <span>Search or run a command…</span>
            <kbd className="ml-auto font-mono text-[10px] text-muted-foreground">⌘K</kbd>
          </button>
        </header>
        <main className="flex-1 overflow-y-auto px-6 py-5">
          <RouteContent route={route} />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} context={context} />
    </div>
  )
}
