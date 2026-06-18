import { useState, type ReactNode } from 'react'
import { Check, ChevronsUpDown, FolderOpen, Plus, Settings2, SquareArrowOutUpRight } from 'lucide-react'
import type { BrainInfo } from '@local-brain/core'
import { useActiveBrain, useBrains, useOpenBrain, useRevealBrain } from '../lib/queries'
import { useRouter } from '../routing/router'
import { BrainDialog, type BrainDialogMode } from './brain-dialog'
import { BrainSwatch } from './brain-swatch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

const ITEM_CLASS =
  'gap-2.5 px-2.5 py-1.5 text-sm text-foreground'

/**
 * The top-level brain picker — Local Brain's port of Reflect's graph switcher.
 * Sits in the sidebar footer: the active brain's swatch + name, opening a
 * keyboard-navigable menu to switch brain, create or open another, reveal the
 * folder, or jump to brain settings. "Brain" is the workspace container; the
 * word "Graph" stays reserved for the Network visualization.
 */
export function BrainSwitcher(): ReactNode {
  const { navigate } = useRouter()
  const active = useActiveBrain()
  const brains = useBrains()
  const openBrain = useOpenBrain()
  const revealBrain = useRevealBrain()

  const [dialog, setDialog] = useState<{ open: boolean; mode: BrainDialogMode }>({
    open: false,
    mode: 'create',
  })

  const activeBrain = active.data
  const others = (brains.data ?? []).filter((brain) => !brain.isActive)

  function switchTo(brain: BrainInfo): void {
    // Guard rapid Switch clicks: a switch in flight is already repointing the
    // live brain, so ignore further picks until it settles. The Rust side
    // serializes switches regardless (see brains.rs), but this avoids firing a
    // redundant second open_brain that would just churn the cache.
    if (openBrain.isPending) return
    if (!brain.isActive) openBrain.mutate(brain.rootPath)
  }

  function openDialog(mode: BrainDialogMode): void {
    setDialog({ open: true, mode })
  }

  return (
    <div className="window-drag-control min-w-0 flex-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left transition-colors hover:bg-secondary/60"
          >
            <BrainSwatch color={activeBrain?.color} className="size-[18px]" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
              {activeBrain?.name ?? 'Local Brain'}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent aria-label="Switch brain" side="top" sideOffset={4}>
          {others.map((brain) => (
            <DropdownMenuItem
              key={brain.rootPath}
              onSelect={() => switchTo(brain)}
              title={brain.rootPath}
              className={ITEM_CLASS}
            >
              <BrainSwatch color={brain.color} className="size-3.5" />
              <span className="min-w-0 flex-1 truncate">{brain.name}</span>
            </DropdownMenuItem>
          ))}
          {activeBrain ? (
            <DropdownMenuItem title={activeBrain.rootPath} className={ITEM_CLASS}>
              <BrainSwatch color={activeBrain.color} className="size-3.5" />
              <span className="min-w-0 flex-1 truncate">{activeBrain.name}</span>
              <Check className="size-3.5 shrink-0 text-primary" />
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={() => openDialog('create')} className={ITEM_CLASS}>
            <Plus className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="flex-1">New brain…</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openDialog('open')} className={ITEM_CLASS}>
            <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="flex-1">Open another brain…</span>
          </DropdownMenuItem>
          {activeBrain ? (
            <DropdownMenuItem
              onSelect={() => revealBrain.mutate(activeBrain.rootPath)}
              className={ITEM_CLASS}
            >
              <SquareArrowOutUpRight className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1">Reveal in file manager</span>
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onSelect={() => navigate({ kind: 'settings', section: 'brain' })}
            className={ITEM_CLASS}
          >
            <Settings2 className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="flex-1">Brain settings</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <BrainDialog
        open={dialog.open}
        mode={dialog.mode}
        onClose={() => setDialog((current) => ({ ...current, open: false }))}
      />
    </div>
  )
}
