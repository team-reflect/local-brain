import type { ReactNode } from 'react'
import { cn } from '../lib/utils'

/** The one calm, politely announced "Loading…" line used by every pane and list. */
export function Loading({ className }: { className?: string }): ReactNode {
  return (
    <p role="status" aria-atomic="true" className={cn('text-sm text-muted-foreground', className)}>
      Loading…
    </p>
  )
}
