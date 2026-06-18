import type { ReactNode } from 'react'
import { AppShell } from './components/app-shell'
import { BrainChooser } from './components/brain-chooser'
import { Loading } from './components/loading'
import { useActiveBrain, useEnsureSeed } from './lib/queries'
import { RouterProvider } from './routing/router'

/**
 * The workspace for one open brain: seed demo data on first run, then mount the
 * typed router and the desktop shell. Keyed by the active brain path in
 * {@link App} so switching brains starts a fresh router history and clean state.
 */
function BrainWorkspace(): ReactNode {
  useEnsureSeed()
  return (
    <RouterProvider>
      <AppShell />
    </RouterProvider>
  )
}

/**
 * App root: resolve the active brain (Local Brain's top-level container), then
 * mount its workspace. While the *initial* connection is being resolved we wait;
 * once it resolves we keep the workspace mounted as long as we hold an active
 * brain. We gate on the data itself, not `isError`: TanStack Query keeps the last
 * successful `active-brain` data when a background refetch fails, so a transient
 * IPC/validation error must not tear down the workspace and drop the user into
 * the chooser while Rust still has a brain open. The chooser only shows when
 * there is genuinely no active brain (the initial resolution produced none).
 * Switching brains re-resolves the active brain and remounts the workspace.
 */
export function App(): ReactNode {
  const active = useActiveBrain()

  if (active.isPending) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <Loading />
      </div>
    )
  }

  if (!active.data) {
    return <BrainChooser />
  }

  return <BrainWorkspace key={active.data.path} />
}
