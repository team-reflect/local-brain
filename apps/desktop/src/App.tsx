import type { ReactNode } from 'react'
import { AppShell } from './components/app-shell'
import { EmbeddingsSync } from './components/embeddings-sync'
import { useEnsureSeed } from './lib/queries'
import { RouterProvider } from './routing/router'

/**
 * App root: seed demo data on first run, then mount the typed router and the
 * desktop shell. The shell owns the sidebar, top command bar, the route switch,
 * and global keyboard shortcuts. `EmbeddingsSync` is a headless coordinator that
 * keeps semantic-search vectors current when the feature is enabled.
 */
export function App(): ReactNode {
  useEnsureSeed()
  return (
    <RouterProvider>
      <EmbeddingsSync />
      <AppShell />
    </RouterProvider>
  )
}
