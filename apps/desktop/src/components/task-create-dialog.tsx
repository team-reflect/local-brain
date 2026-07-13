import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { OPEN_TASK_STATUSES } from '@local-brain/core'
import { useBlockingModal } from '../lib/commands/use-blocking-modal'
import { useCreateTask, useProjects } from '../lib/queries'
import { sectionLabel } from '../lib/ui'
import { errorMessage } from '../lib/utils'
import { Button } from './button'
import { QueryError } from './query-error'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { NativeSelect } from './ui/native-select'
import { Textarea } from './ui/textarea'

interface TaskCreateDialogProps {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
  defaultProjectId?: string
}

/** Create a task from the desktop without leaving the current working context. */
export function TaskCreateDialog({
  open,
  onClose,
  onCreated,
  defaultProjectId,
}: TaskCreateDialogProps): ReactNode {
  const createTask = useCreateTask()
  const resetCreateTask = createTask.reset
  const projects = useProjects()
  const inputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('open')
  const [projectId, setProjectId] = useState(defaultProjectId ?? '')
  const [dueAt, setDueAt] = useState('')
  const [scheduledFor, setScheduledFor] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const projectsReady = projects.data !== undefined
  const selectedProjectId =
    projectId !== '' && projects.data?.some((project) => project.id === projectId)
      ? projectId
      : ''

  useBlockingModal(open)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setDescription('')
    setStatus('open')
    setProjectId(defaultProjectId ?? '')
    setDueAt('')
    setScheduledFor('')
    setValidationError(null)
    resetCreateTask()
  }, [defaultProjectId, open, resetCreateTask])

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!projectsReady) return

    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setValidationError('Title is required')
      inputRef.current?.focus()
      return
    }

    setValidationError(null)
    try {
      const id = await createTask.mutateAsync({
        title: trimmedTitle,
        status,
        description: description.trim() || null,
        projectId: selectedProjectId || null,
        dueAt: dueAt || null,
        scheduledFor: scheduledFor || null,
      })
      onCreated(id)
      onClose()
    } catch {
      // The mutation error remains rendered in the form so the user's input is preserved.
    }
  }

  const displayedError = validationError ?? (createTask.isError ? errorMessage(createTask.error) : null)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !createTask.isPending) onClose()
      }}
    >
      <DialogContent
        className="w-[min(32rem,calc(100vw-2rem))]"
        aria-describedby="new-task-description"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus()
        }}
        onEscapeKeyDown={(event) => {
          if (createTask.isPending) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (createTask.isPending) event.preventDefault()
        }}
      >
        <DialogTitle className="border-b border-border px-4 py-2.5">New task</DialogTitle>
        <DialogDescription id="new-task-description" className="sr-only">
          Create a task with optional workflow, project, and date details.
        </DialogDescription>
        <form onSubmit={submit} className="flex flex-col gap-4 p-4">
          <label className="flex flex-col gap-1.5">
            <span className={sectionLabel}>Title</span>
            <Input
              ref={inputRef}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value)
                setValidationError(null)
              }}
              aria-invalid={validationError ? true : undefined}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={sectionLabel}>Description</span>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              className="min-h-20 font-normal"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className={sectionLabel}>Status</span>
              <NativeSelect value={status} onChange={(event) => setStatus(event.target.value)}>
                {OPEN_TASK_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {statusLabel(option)}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={sectionLabel}>Project</span>
              <NativeSelect
                value={selectedProjectId}
                disabled={!projectsReady}
                aria-invalid={projects.isError && !projectsReady ? true : undefined}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="">
                  {!projectsReady
                    ? projects.isError
                      ? 'Projects unavailable'
                      : 'Loading projects…'
                    : 'No project'}
                </option>
                {projects.data?.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </div>

          {!projectsReady && projects.isPending ? (
            <p role="status" className="text-xs text-muted-foreground">
              Loading projects…
            </p>
          ) : projects.isError ? (
            <QueryError
              title={projectsReady ? 'Could not refresh projects' : 'Could not load projects'}
              error={projects.error}
              onRetry={() => void projects.refetch()}
            />
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className={sectionLabel}>Due</span>
              <Input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={sectionLabel}>Scheduled</span>
              <Input
                type="date"
                value={scheduledFor}
                onChange={(event) => setScheduledFor(event.target.value)}
              />
            </label>
          </div>

          {displayedError ? (
            <p role="alert" className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle aria-hidden className="size-3.5" />
              {displayedError}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose} disabled={createTask.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={createTask.isPending || !projectsReady}
            >
              {createTask.isPending ? 'Creating…' : 'Create task'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}
