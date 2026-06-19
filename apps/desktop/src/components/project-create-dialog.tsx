import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { useCreateProject } from '../lib/queries'
import { cn } from '../lib/utils'
import { Button } from './button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

interface ProjectCreateDialogProps {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}

export function ProjectCreateDialog({ open, onClose, onCreated }: ProjectCreateDialogProps): ReactNode {
  const createProject = useCreateProject()
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setError(null)
  }, [open])

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Name is required')
      inputRef.current?.focus()
      return
    }

    setError(null)
    try {
      const id = await createProject.mutateAsync(trimmed)
      onCreated(id)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create project')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        className="w-[22rem]"
        aria-describedby="new-project-description"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <DialogTitle className="border-b border-border px-4 py-2.5">New project</DialogTitle>
        <DialogDescription id="new-project-description" className="sr-only">
          Create a project record.
        </DialogDescription>
        <form onSubmit={submit} className="flex flex-col gap-3 p-4">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-[hsl(var(--lb-ink-2))]">
            Name
            <input
              ref={inputRef}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                if (error) setError(null)
              }}
              aria-invalid={error ? true : undefined}
              className={cn(
                'h-8 rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20',
                error ? 'border-destructive focus:border-destructive focus:ring-destructive/20' : null,
              )}
            />
          </label>
          {error ? (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="size-3.5" />
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose} disabled={createProject.isPending}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={createProject.isPending}>
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
