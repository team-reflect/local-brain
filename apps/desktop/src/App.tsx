import type { ReactNode } from 'react'
import { AppShell } from './components/app-shell'
import { useEnsureSeed } from './lib/queries'
import { RouterProvider } from './routing/router'

/**
 * App root: seed demo data on first run, then mount the typed router and the
 * desktop shell. The shell owns the sidebar, top command bar, the route switch,
 * and global keyboard shortcuts.
 */
export function App(): ReactNode {
  useEnsureSeed()
  return (
    <RouterProvider>
      <AppShell />
    </RouterProvider>
  )
}
