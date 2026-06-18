import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronsUpDown, FolderOpen, Plus, Settings2, SquareArrowOutUpRight } from 'lucide-react'
import type { BrainInfo } from '@local-brain/core'
import { cn } from '../lib/utils'
import { useActiveBrain, useBrains, useOpenBrain, useRevealBrain } from '../lib/queries'
import { useRouter } from '../routing/router'
import { BrainDialog, type BrainDialogMode } from './brain-dialog'
import { BrainSwatch } from './brain-swatch'

const ITEM_CLASS =
  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-secondary focus:bg-secondary focus:outline-none'

/**
 * The top-level brain picker — Local Brain's port of Reflect's graph switcher.
 * Sits in the sidebar brand slot: the active brain's swatch + name, opening a
 * keyboard-navigable menu to switch brain, create or open another, reveal the
 * file, or jump to brain settings. "Brain" is the workspace container; the word
 * "Graph" stays reserved for the Network visualization.
 */
export function BrainSwitcher(): ReactNode {
  const { navigate } = useRouter()
  const active = useActiveBrain()
  const brains = useBrains()
  const openBrain = useOpenBrain()
  const revealBrain = useRevealBrain()

  const [menuOpen, setMenuOpen] = useState(false)
  const [dialog, setDialog] = useState<{ open: boolean; mode: BrainDialogMode }>({
    open: false,
    mode: 'create',
  })
  const menuRef = useRef<HTMLDivElement>(null)

  // Focus the first menu item when the menu opens (keyboard entry).
  useEffect(() => {
    if (menuOpen) {
      menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    }
  }, [menuOpen])

  const activeBrain = active.data
  const others = (brains.data ?? []).filter((brain) => !brain.isActive)

  function closeMenu(): void {
    setMenuOpen(false)
  }

  function switchTo(brain: BrainInfo): void {
    closeMenu()
    // Guard rapid Switch clicks: a switch in flight is already repointing the
    // live brain, so ignore further picks until it settles. The Rust side
    // serializes switches regardless (see brains.rs), but this avoids firing a
    // redundant second open_brain that would just churn the cache.
    if (openBrain.isPending) return
    if (!brain.isActive) openBrain.mutate(brain.path)
  }

  function openDialog(mode: BrainDialogMode): void {
    closeMenu()
    setDialog({ open: true, mode })
  }

  // Roving arrow-key navigation across the menu's buttons.
  function onMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      closeMenu()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    if (items.length === 0) return
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      event.key === 'ArrowDown'
        ? (index + 1) % items.length
        : (index - 1 + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <div className="relative px-4 pb-1">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-secondary/60"
      >
        <BrainSwatch color={activeBrain?.color} className="size-[18px]" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {activeBrain?.name ?? 'Local Brain'}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>

      {menuOpen ? (
        <>
          <div className="fixed inset-0 z-40" onClick={closeMenu} aria-hidden />
          <div
            ref={menuRef}
            role="menu"
            aria-label="Switch brain"
            onKeyDown={onMenuKeyDown}
            className="absolute left-3 right-3 top-full z-50 mt-1 flex flex-col gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-[0_8px_28px_rgba(2,6,23,0.16)]"
          >
            {others.map((brain) => (
              <button
                key={brain.path}
                type="button"
                role="menuitem"
                onClick={() => switchTo(brain)}
                title={brain.path}
                className={ITEM_CLASS}
              >
                <BrainSwatch color={brain.color} className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">{brain.name}</span>
              </button>
            ))}
            {activeBrain ? (
              <button
                type="button"
                role="menuitem"
                onClick={closeMenu}
                title={activeBrain.path}
                className={cn(ITEM_CLASS, 'cursor-default')}
              >
                <BrainSwatch color={activeBrain.color} className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">{activeBrain.name}</span>
                <Check className="size-3.5 shrink-0 text-primary" />
              </button>
            ) : null}

            <div className="my-1 h-px bg-border" />

            <button type="button" role="menuitem" onClick={() => openDialog('create')} className={ITEM_CLASS}>
              <Plus className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1">New brain…</span>
            </button>
            <button type="button" role="menuitem" onClick={() => openDialog('open')} className={ITEM_CLASS}>
              <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1">Open another brain…</span>
            </button>
            {activeBrain ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu()
                  revealBrain.mutate(activeBrain.path)
                }}
                className={ITEM_CLASS}
              >
                <SquareArrowOutUpRight className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1">Reveal in file manager</span>
              </button>
            ) : null}

            <div className="my-1 h-px bg-border" />

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu()
                navigate({ kind: 'settings', section: 'brain' })
              }}
              className={ITEM_CLASS}
            >
              <Settings2 className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1">Brain settings</span>
            </button>
          </div>
        </>
      ) : null}

      <BrainDialog
        open={dialog.open}
        mode={dialog.mode}
        onClose={() => setDialog((current) => ({ ...current, open: false }))}
      />
    </div>
  )
}
