import { useEffect, useRef, useState, type ReactNode } from 'react'
import { isAppError, type BrainInfo } from '@local-brain/core'
import { controlClass, sectionLabel } from '../lib/ui'
import { useCreateBrain, useOpenBrain } from '../lib/queries'
import { pickBrainToCreate, pickBrainToOpen } from '../lib/native-dialog'
import { Alert } from './alert'
import { Button } from './button'

export type BrainDialogMode = 'create' | 'open'

/**
 * Create a new brain, or open an existing one. The primary affordance is the
 * native OS file dialog (via `@tauri-apps/plugin-dialog`): "Browse…" opens a
 * file picker for an existing brain, or a save dialog for a new one. The path
 * field stays editable as a validated fallback (and to show the chosen path) —
 * Rust validates either way, so a bad path or an existing file surfaces the
 * error rather than failing quietly.
 */
export function BrainDialog({
  open,
  mode,
  onClose,
  onSwitched,
}: {
  open: boolean
  mode: BrainDialogMode
  onClose: () => void
  onSwitched?: (brain: BrainInfo) => void
}): ReactNode {
  const createBrain = useCreateBrain()
  const openBrain = useOpenBrain()
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset and focus whenever the dialog (re)opens.
  const [openedFor, setOpenedFor] = useState<BrainDialogMode | null>(null)
  if (open && openedFor !== mode) {
    setOpenedFor(mode)
    setPath('')
    setName('')
    setError(null)
  }
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open, mode])

  if (!open) {
    if (openedFor !== null) setOpenedFor(null)
    return null
  }

  const busy = createBrain.isPending || openBrain.isPending
  const isCreate = mode === 'create'

  async function browse(): Promise<void> {
    setError(null)
    try {
      const chosen = isCreate ? await pickBrainToCreate() : await pickBrainToOpen()
      if (chosen) setPath(chosen)
    } catch {
      setError('Could not open the file picker — enter the path manually instead.')
    }
  }

  async function submit(): Promise<void> {
    setError(null)
    const target = path.trim()
    if (!target) {
      setError('Enter a path to the brain database file.')
      return
    }
    try {
      const trimmedName = name.trim()
      const brain = isCreate
        ? await createBrain.mutateAsync(
            trimmedName ? { path: target, name: trimmedName } : { path: target },
          )
        : await openBrain.mutateAsync(target)
      onSwitched?.(brain)
      onClose()
    } catch (err) {
      setError(isAppError(err) ? err.message : `Could not ${isCreate ? 'create' : 'open'} the brain.`)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/25 pt-[12vh] backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isCreate ? 'New brain' : 'Open another brain'}
        className="flex w-[32rem] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-[0_8px_28px_rgba(2,6,23,0.16)]"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <div className="border-b border-border px-4 py-2.5 text-sm font-semibold">
          {isCreate ? 'New brain' : 'Open another brain'}
        </div>
        <div className="flex flex-col gap-3 px-4 py-3">
          {error ? <Alert variant="error">{error}</Alert> : null}
          <p className="text-xs text-muted-foreground">
            {isCreate
              ? 'A brain is one SQLite database file. Choose where to create it (the file and its folders are created for you), or type an absolute path that does not exist yet.'
              : 'Choose an existing brain database file (a .sqlite created by Local Brain), or type its absolute path.'}
          </p>
          {isCreate ? (
            <label className="flex flex-col gap-1">
              <span className={sectionLabel}>Name (optional)</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Work brain"
                className={controlClass}
              />
            </label>
          ) : null}
          <label className="flex flex-col gap-1">
            <span className={sectionLabel}>Database path</span>
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="/Users/you/brains/work.sqlite"
                spellCheck={false}
                className={`${controlClass} flex-1 font-mono text-xs`}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submit()
                }}
              />
              <Button variant="secondary" onClick={() => void browse()}>
                Browse…
              </Button>
            </div>
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {isCreate ? 'Create brain' : 'Open brain'}
          </Button>
        </div>
      </div>
    </div>
  )
}
