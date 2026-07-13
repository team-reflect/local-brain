import type { ReactNode } from 'react'
import { errorMessage } from '../lib/utils'
import { Alert } from './alert'
import { Button } from './button'

/** A compact, retryable error state shared by query-backed lists and details. */
export function QueryError({
  title,
  error,
  onRetry,
  className,
}: {
  title: string
  error: unknown
  onRetry?: () => unknown
  className?: string
}): ReactNode {
  const message = error == null ? null : errorMessage(error)

  return (
    <Alert
      variant="error"
      {...(className !== undefined ? { className } : {})}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium">{title}</p>
          {message && message !== title ? (
            <p className="mt-0.5 break-words text-destructive/90">{message}</p>
          ) : null}
        </div>
        {onRetry ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 border-destructive/30 bg-transparent text-destructive hover:bg-destructive/10"
            onClick={() => onRetry()}
          >
            Try again
          </Button>
        ) : null}
      </div>
    </Alert>
  )
}
