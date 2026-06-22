import { useCallback, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ListTodo,
  MessageSquare,
  Search,
  Settings,
  Users,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { controlClass, keycapClass } from '../lib/ui'
import { useAppShortcuts } from '../lib/commands/use-shortcuts'
import type { CommandContext } from '../lib/commands/types'
import { sectionForRoute, type Route } from '../routing/route'
import { useRouter } from '../routing/router'
import { BrainSwitcher } from './brain-switcher'
import { CommandPalette } from './command-palette'
import { FirstRun } from './first-run'
import { RouteContent } from './route-content'
import { SidebarProjects } from './sidebar-projects'
import { UpdateNotice } from './update-notice'
import { WindowDragRegion } from './window-drag-region'

interface NavItem {
  section: string
  label: string
  icon: ComponentType<{ className?: string }>
  route: Route
}

const NAV: readonly NavItem[] = [
  { section: 'today', label: 'Today', icon: CalendarDays, route: { kind: 'today' } },
  { section: 'chat', label: 'Chat', icon: MessageSquare, route: { kind: 'chat' } },
  { section: 'tasks', label: 'Tasks', icon: ListTodo, route: { kind: 'tasks' } },
  { section: 'network', label: 'Network', icon: Users, route: { kind: 'network', tab: 'graph' } },
]

const HISTORY_BUTTON_CLASS =
  'rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent'

const SEARCH_TRIGGER_CLASS = cn(
  controlClass,
  'window-drag-control flex h-8 w-full cursor-text items-center gap-2 px-2.5 py-0 text-xs text-muted-foreground hover:text-foreground',
)

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
  const settingsActive = activeSection === 'settings'

  return (
    <div className="flex h-full min-h-0">
      <WindowDragRegion />
      <aside className="flex min-h-0 w-[260px] shrink-0 flex-col overflow-y-auto overscroll-contain border-r border-border bg-[hsl(var(--lb-sidebar))] py-5">
        <div aria-hidden className="h-9 shrink-0" />
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
          <SidebarProjects activeSection={activeSection} route={route} />
        </nav>
        <div className="mt-auto" />
        <UpdateNotice />
        <div className="flex items-center gap-1 px-4 pt-2">
          <BrainSwitcher />
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

      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <header className="flex h-12 items-center justify-center border-b border-border px-4">
          <div className="relative w-[min(760px,100%)]">
            <div className="absolute left-0 top-1/2 z-40 flex -translate-x-[calc(100%+0.5rem)] -translate-y-1/2 items-center gap-1">
              <button
                type="button"
                onClick={back}
                disabled={!canBack}
                aria-label="Back"
                className={HISTORY_BUTTON_CLASS}
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                onClick={forward}
                disabled={!canForward}
                aria-label="Forward"
                className={HISTORY_BUTTON_CLASS}
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={openPalette}
              aria-label="Search or run a command"
              className={SEARCH_TRIGGER_CLASS}
            >
              <Search className="size-3.5" />
              <span className="flex-1 truncate text-left">Search anything…</span>
              <kbd className={keycapClass}>⌘K</kbd>
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
          <RouteContent route={route} />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} context={context} />
      <FirstRun />
    </div>
  )
}
