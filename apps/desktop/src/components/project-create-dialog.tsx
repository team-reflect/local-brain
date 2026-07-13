import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { useBlockingModal } from '../lib/commands/use-blocking-modal'
import { useCreateProject } from '../lib/queries'
import { Button } from './button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'

interface ProjectCreateDialogProps {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}

export function ProjectCreateDialog({ open, onClose, onCreated }: ProjectCreateDialogProps): ReactNode {
  const createProject = useCreateProject()
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  useBlockingModal(open)

  useEffect(() => {
    if (!open) return
    setName('')
    setDescription('')
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
      const id = await createProject.mutateAsync({ name: trimmed, summary: description })
      onCreated(id)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create project')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !createProject.isPending) onClose()
      }}
    >
      <DialogContent
        className="w-[22rem]"
        aria-describedby="new-project-description"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus()
        }}
        onEscapeKeyDown={(event) => {
          if (createProject.isPending) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (createProject.isPending) event.preventDefault()
        }}
      >
        <DialogTitle className="border-b border-border px-4 py-2.5">New project</DialogTitle>
        <DialogDescription id="new-project-description" className="sr-only">
          Create a project with an optional description.
        </DialogDescription>
        <form onSubmit={submit} className="flex flex-col gap-3 p-4">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-[hsl(var(--lb-ink-2))]">
            Name
            <Input
              ref={inputRef}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                if (error) setError(null)
              }}
              aria-invalid={error ? true : undefined}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-[hsl(var(--lb-ink-2))]">
            Description
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              className="min-h-20 font-normal"
            />
          </label>
          {error ? (
            <p role="alert" className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle aria-hidden className="size-3.5" />
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
