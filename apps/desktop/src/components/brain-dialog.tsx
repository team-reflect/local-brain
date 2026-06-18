import { useEffect, useRef, useState, type ReactNode } from 'react'
import { isAppError, type BrainInfo } from '@local-brain/core'
import { controlClass, sectionLabel } from '../lib/ui'
import { useCreateBrain, useOpenBrain } from '../lib/queries'
import { Alert } from './alert'
import { Button } from './button'

export type BrainDialogMode = 'create' | 'open'

/**
 * Create a new brain, or open an existing one, by absolute path. A native file
 * picker is a documented follow-up (Local Brain doesn't yet bundle the Tauri
 * dialog plugin); the path is validated by Rust, so this is fully functional —
 * a bad path or an existing file surfaces the error rather than failing quietly.
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
              ? 'A brain is one SQLite database file. Give an absolute path that does not exist yet — the file and its folders are created for you.'
              : 'Enter the absolute path to an existing brain database file (a .sqlite created by Local Brain).'}
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
            <input
              ref={inputRef}
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder={isCreate ? '/Users/you/brains/work.sqlite' : '/Users/you/brains/work.sqlite'}
              spellCheck={false}
              className={`${controlClass} font-mono text-xs`}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit()
              }}
            />
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
