import { useId, type MouseEvent, type ReactNode } from 'react'
import { AlertCircle, LoaderCircle } from 'lucide-react'
import { useSetTaskCompleted } from '../lib/queries'
import { cn, errorMessage } from '../lib/utils'
import { useTaskCompletionFeedback } from './task-completion-feedback'
import { Checkbox } from './ui/checkbox'

interface TaskCompletionControlProps {
  id: string
  title: string
  status: string
  className?: string
  disabled?: boolean
}

/** A reusable, reversible task checkbox with pending and rollback feedback. */
export function TaskCompletionControl({
  id,
  title,
  status,
  className,
  disabled = false,
}: TaskCompletionControlProps): ReactNode {
  const feedback = useTaskCompletionFeedback()
  const mutation = useSetTaskCompleted({
    onError: (cause, input) => {
      feedback?.reportFailure({
        taskId: id,
        title,
        action: input.completed ? 'complete' : 'reopen',
        message: errorMessage(cause),
      })
    },
  })
  const errorId = useId()
  const completed = status === 'done'
  const label = completed ? `Reopen ${title}` : `Complete ${title}`
  const mutationError = mutation.isError && feedback === null ? errorMessage(mutation.error) : null

  function stopRowClick(event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation()
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <Checkbox
        checked={completed}
        disabled={disabled || mutation.isPending}
        onClick={stopRowClick}
        onCheckedChange={(checked) => {
          feedback?.clearFailure(id)
          mutation.reset()
          mutation.mutate({ id, completed: checked === true })
        }}
        aria-label={label}
        aria-describedby={mutationError ? errorId : undefined}
        className={cn('size-4 rounded-full', className)}
      />
      {mutation.isPending ? (
        <LoaderCircle aria-label={`Updating ${title}`} className="size-3 animate-spin text-muted-foreground" />
      ) : null}
      {mutationError ? (
        <span
          id={errorId}
          role="alert"
          title={mutationError}
          aria-label={`Could not update ${title}: ${mutationError}`}
          className="text-destructive"
        >
          <AlertCircle aria-hidden className="size-3.5" />
        </span>
      ) : null}
    </span>
  )
}
