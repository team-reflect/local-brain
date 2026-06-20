// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AppShell } from './app-shell'

const queryMocks = vi.hoisted(() => ({
  createProject: {
    isPending: false,
    mutateAsync: vi.fn(),
  },
}))

vi.mock('../routing/router', () => ({
  useRouter: () => ({
    route: { kind: 'today' },
    navigate: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    canBack: false,
    canForward: true,
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

afterEach(() => cleanup())

describe('AppShell', () => {
  it('places Ask directly under Today in the sidebar', () => {
    render(<AppShell />)

    const navItems = screen.getAllByRole('button').map((button) => button.textContent?.trim())

    expect(navItems.indexOf('Ask')).toBe(navItems.indexOf('Today') + 1)
  })

  it('places history arrows in the main header beside search, not in the sidebar', () => {
    render(<AppShell />)

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

  it('renders projects as a collapsible sidebar section', () => {
    render(<AppShell />)

    const projects = screen.getByRole('button', { name: /Projects/ })
    expect(projects.querySelectorAll('svg')).toHaveLength(1)
    expect(projects.querySelector('svg')?.classList.contains('lucide-folder-open')).toBe(true)
    expect(screen.getByRole('button', { name: 'Apollo' })).toBeDefined()

    fireEvent.click(projects)

    expect(projects.getAttribute('aria-expanded')).toBe('false')
    expect(projects.querySelectorAll('svg')).toHaveLength(1)
    expect(projects.querySelector('svg')?.classList.contains('lucide-folder-closed')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Apollo' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Create project' })).toBeDefined()
  })
})
