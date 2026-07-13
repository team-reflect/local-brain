// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, type RenderResult } from '@testing-library/react'
import { UpdateProvider } from '../providers/update-provider'
import type { Route } from '../routing/route'
import { AppShell } from './app-shell'

const queryMocks = vi.hoisted(() => ({
  createProject: {
    isPending: false,
    mutateAsync: vi.fn(),
  },
  createTask: {
    isPending: false,
    isError: false,
    error: null,
    mutateAsync: vi.fn(),
    reset: vi.fn(),
  },
}))

const routerMocks = vi.hoisted(() => ({
  route: { kind: 'today' } as Route,
  entryKey: 'entry-1',
  navigationType: 'initial' as 'initial' | 'push' | 'pop' | 'replace',
  navigate: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
}))

vi.mock('../routing/router', () => ({
  useRouter: () => ({
    route: routerMocks.route,
    navigate: routerMocks.navigate,
    back: routerMocks.back,
    forward: routerMocks.forward,
    canBack: false,
    canForward: true,
    entryKey: routerMocks.entryKey,
    navigationType: routerMocks.navigationType,
  }),
}))

vi.mock('../lib/queries', () => ({
  useProjects: () => ({
    isLoading: false,
    data: [
      {
        id: 'project-1',
        name: 'Apollo',
        status: 'active',
        kind: null,
        summary: null,
        notes: null,
        startedOn: null,
        targetDate: null,
        completedOn: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        archivedAt: null,
      },
    ],
  }),
  useCreateProject: () => queryMocks.createProject,
  useCreateTask: () => queryMocks.createTask,
}))

vi.mock('./brain-switcher', () => ({
  BrainSwitcher: () => <div data-testid="brain-switcher" />,
}))

vi.mock('./command-palette', () => ({
  CommandPalette: () => null,
}))

vi.mock('./first-run', () => ({
  FirstRun: () => null,
}))

vi.mock('./route-content', () => ({
  RouteContent: () => <div data-testid="route-content" />,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  routerMocks.route = { kind: 'today' }
  routerMocks.entryKey = 'entry-1'
  routerMocks.navigationType = 'initial'
})

function renderShell(): RenderResult {
  return render(
    <UpdateProvider autoCheck={false}>
      <AppShell />
    </UpdateProvider>,
  )
}

describe('AppShell', () => {
  it('places Chat directly under Today in the sidebar', () => {
    renderShell()

    const navItems = screen.getAllByRole('button').map((button) => button.textContent?.trim())

    expect(navItems.indexOf('Chat')).toBe(navItems.indexOf('Today') + 1)
  })

  it('marks only the active main navigation item as current', () => {
    renderShell()

    expect(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'Chat' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('button', { name: 'Tasks' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('button', { name: 'Network' }).getAttribute('aria-current')).toBeNull()
  })

  it('marks a section ancestor as the current location, not the current page', () => {
    routerMocks.route = { kind: 'task', id: 'task-1' }
    renderShell()

    expect(screen.getByRole('button', { name: 'Tasks' }).getAttribute('aria-current')).toBe('location')
    expect(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-current')).toBeNull()
  })

  it('places history arrows in the main header beside search, not in the sidebar', () => {
    renderShell()

    const search = screen.getByRole('button', { name: 'Search or run a command' })
    const back = screen.getByRole('button', { name: 'Back' })
    const forward = screen.getByRole('button', { name: 'Forward' })
    const sidebar = screen.getByRole('complementary')

    expect(search.closest('header')).toBeTruthy()
    expect(back.closest('header')).toBe(search.closest('header'))
    expect(forward.closest('header')).toBe(search.closest('header'))
    expect(back.closest('aside')).not.toBe(sidebar)
    expect(forward.closest('aside')).not.toBe(sidebar)
    expect(back.parentElement?.className).toContain('absolute')
  })

  it('resets fresh routes, restores history scroll, and focuses route content', () => {
    const view = renderShell()
    const main = screen.getByRole('main')
    main.scrollTop = 240

    routerMocks.route = { kind: 'tasks' }
    routerMocks.entryKey = 'entry-2'
    routerMocks.navigationType = 'push'
    view.rerender(
      <UpdateProvider autoCheck={false}>
        <AppShell />
      </UpdateProvider>,
    )

    expect(main.scrollTop).toBe(0)
    expect(document.activeElement).toBe(main)

    main.scrollTop = 80
    routerMocks.route = { kind: 'today' }
    routerMocks.entryKey = 'entry-1'
    routerMocks.navigationType = 'pop'
    view.rerender(
      <UpdateProvider autoCheck={false}>
        <AppShell />
      </UpdateProvider>,
    )

    expect(main.scrollTop).toBe(240)
  })

  it('navigates to Projects separately from expanding and collapsing its children', () => {
    renderShell()

    const projects = screen.getByRole('button', { name: 'Projects' })
    const collapse = screen.getByRole('button', { name: 'Collapse projects' })
    expect(projects.querySelectorAll('svg')).toHaveLength(1)
    expect(projects.querySelector('svg')?.classList.contains('lucide-folder-open')).toBe(true)
    expect(screen.getByRole('button', { name: 'Apollo' })).toBeDefined()

    fireEvent.click(projects)

    expect(routerMocks.navigate).toHaveBeenCalledWith({ kind: 'projects' })
    expect(screen.getByRole('button', { name: 'Apollo' })).toBeDefined()
    expect(collapse.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(collapse)

    expect(screen.getByRole('button', { name: 'Expand projects' }).getAttribute('aria-expanded')).toBe('false')
    expect(projects.querySelectorAll('svg')).toHaveLength(1)
    expect(projects.querySelector('svg')?.classList.contains('lucide-folder-closed')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Apollo' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Create project' })).toBeDefined()
  })
})
