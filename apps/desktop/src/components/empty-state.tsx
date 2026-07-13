import type { ReactNode } from 'react'
import { cn } from '../lib/utils'

type EmptyStateVariant = 'panel' | 'plain'

/** Calm, text-forward empty state for lists and panes. */
export function EmptyState({
  title,
  hint,
  action,
  variant = 'panel',
}: {
  title: string
  hint?: ReactNode
  action?: ReactNode
  variant?: EmptyStateVariant
}): ReactNode {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1 px-6 py-10 text-center',
        variant === 'panel' && 'rounded-lg border border-dashed border-border bg-secondary/30',
      )}
    >
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}
