import type { ReactNode } from 'react'
import { cn } from '../lib/utils'

/** The one calm "Loading…" line, so every pane/list waits the same way. */
export function Loading({ className }: { className?: string }): ReactNode {
  return <p className={cn('text-sm text-muted-foreground', className)}>Loading…</p>
}
