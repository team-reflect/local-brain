import { useState, type ReactNode } from 'react'
import { FolderOpen, FolderPlus } from 'lucide-react'
import { useBrains, useOpenBrain } from '../lib/queries'
import { Button } from './button'
import { BrainDialog, type BrainDialogMode } from './brain-dialog'
import { BrainSwatch } from './brain-swatch'

/**
 * The no-active-brain fallback. Local Brain always opens a brain at startup, so
 * this is reached only when the active brain can't be resolved (a moved or
 * deleted file). It lists known brains to reopen and offers create/open — the
 * same path-based flow as the switcher.
 */
export function BrainChooser(): ReactNode {
  const brains = useBrains()
  const openBrain = useOpenBrain()
  const [dialog, setDialog] = useState<{ open: boolean; mode: BrainDialogMode }>({
    open: false,
    mode: 'open',
  })

  return (
    <div className="flex h-full w-full items-center justify-center bg-background p-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-lg font-semibold text-foreground">Open a brain</h1>
          <p className="text-sm text-muted-foreground">
            A brain is one local SQLite database. Pick a recent brain or open another.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Button variant="primary" className="w-full" onClick={() => setDialog({ open: true, mode: 'create' })}>
            <FolderPlus className="size-4" aria-hidden />
            New brain…
          </Button>
          <Button variant="outline" className="w-full" onClick={() => setDialog({ open: true, mode: 'open' })}>
            <FolderOpen className="size-4" aria-hidden />
            Open another brain…
          </Button>
        </div>

        {(brains.data?.length ?? 0) > 0 ? (
          <div className="space-y-1">
            <p className="px-1 text-[11px] font-medium text-muted-foreground">Recent</p>
            <ul className="space-y-px">
              {brains.data?.map((brain) => (
                <li key={brain.path}>
                  <button
                    type="button"
                    onClick={() => openBrain.mutate(brain.path)}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-secondary"
                  >
                    <BrainSwatch color={brain.color} className="size-4" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{brain.name}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">{brain.path}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <BrainDialog
        open={dialog.open}
        mode={dialog.mode}
        onClose={() => setDialog((current) => ({ ...current, open: false }))}
      />
    </div>
  )
}
