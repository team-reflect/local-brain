// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { AppShell } from './app-shell'

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
})
