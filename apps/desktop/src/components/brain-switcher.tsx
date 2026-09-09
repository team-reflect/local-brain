import { useId, useState, type ReactNode } from 'react'
import { Check, ChevronsUpDown, FolderOpen, Plus, Settings2, SquareArrowOutUpRight } from 'lucide-react'
import type { BrainInfo } from '@local-brain/core'
import { useActiveBrain, useBrains, useOpenBrain, useRevealBrain } from '../lib/queries'
import { useRouter } from '../routing/router'
import { Alert } from './alert'
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
  const [menuOpen, setMenuOpen] = useState(false)
  const feedbackId = useId()

  const [dialog, setDialog] = useState<{ open: boolean; mode: BrainDialogMode }>({
    open: false,
    mode: 'create',
  })

  const activeBrain = active.data
  const others = (brains.data ?? []).filter((brain) => !brain.isActive)
  const busy = openBrain.isPending || revealBrain.isPending
  const pendingMessage = openBrain.isPending
    ? 'Opening brain…'
    : revealBrain.isPending
      ? 'Opening folder…'
      : null
  const errorMessage = openBrain.isError
    ? 'Could not open this brain. Try again or open another brain.'
    : revealBrain.isError
      ? 'Could not reveal this folder. Try again.'
      : null
  const feedback = pendingMessage ? (
    <p id={feedbackId} role="status" className="px-2.5 py-2 text-xs text-muted-foreground">
      {pendingMessage}
    </p>
  ) : errorMessage ? (
    <div id={feedbackId} className="py-1">
      <Alert variant="error">{errorMessage}</Alert>
    </div>
  ) : null

  function switchTo(brain: BrainInfo): void {
    if (busy || brain.isActive) return
    revealBrain.reset()
    openBrain.mutate(brain.rootPath, { onSuccess: () => setMenuOpen(false) })
  }

  function reveal(): void {
    if (busy || !activeBrain) return
    openBrain.reset()
    revealBrain.mutate(activeBrain.rootPath, { onSuccess: () => setMenuOpen(false) })
  }

  function openDialog(mode: BrainDialogMode): void {
    if (busy) return
    openBrain.reset()
    revealBrain.reset()
    setDialog({ open: true, mode })
  }

  return (
    <div className="window-drag-control min-w-0 flex-1">
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-busy={busy}
            aria-describedby={feedback ? feedbackId : undefined}
            className="flex h-10 w-full items-center gap-2.5 rounded-md px-2 text-left transition-colors hover:bg-secondary/60"
          >
            <BrainSwatch color={activeBrain?.color} className="size-[18px]" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
              {activeBrain?.name ?? 'Local Brain'}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          aria-label="Switch brain"
          side="top"
          sideOffset={4}
          className="w-auto min-w-56 max-w-72"
        >
          {menuOpen ? feedback : null}
          {others.map((brain) => (
            <DropdownMenuItem
              key={brain.rootPath}
              disabled={busy}
              onSelect={(event) => {
                event.preventDefault()
                switchTo(brain)
              }}
              title={brain.rootPath}
              className={ITEM_CLASS}
            >
              <BrainSwatch color={brain.color} className="size-3.5" />
              <span className="min-w-0 flex-1 truncate">{brain.name}</span>
            </DropdownMenuItem>
          ))}
          {activeBrain ? (
            <DropdownMenuItem disabled={busy} title={activeBrain.rootPath} className={ITEM_CLASS}>
              <BrainSwatch color={activeBrain.color} className="size-3.5" />
              <span className="min-w-0 flex-1 truncate">{activeBrain.name}</span>
              <Check className="size-3.5 shrink-0 text-primary" />
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuSeparator />

          <DropdownMenuItem disabled={busy} onSelect={() => openDialog('create')} className={ITEM_CLASS}>
            <Plus className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="flex-1">New brain…</span>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy} onSelect={() => openDialog('open')} className={ITEM_CLASS}>
            <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="flex-1">Open another brain…</span>
          </DropdownMenuItem>
          {activeBrain ? (
            <DropdownMenuItem
              disabled={busy}
              onSelect={(event) => {
                event.preventDefault()
                reveal()
              }}
              className={ITEM_CLASS}
            >
              <SquareArrowOutUpRight className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1">Reveal in file manager</span>
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            disabled={busy}
            onSelect={() => navigate({ kind: 'settings', section: 'brain' })}
            className={ITEM_CLASS}
          >
            <Settings2 className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="flex-1">Brain settings</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {!menuOpen ? feedback : null}

      <BrainDialog
        open={dialog.open}
        mode={dialog.mode}
        onClose={() => setDialog((current) => ({ ...current, open: false }))}
      />
    </div>
  )
}
