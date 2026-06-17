import type { ReactNode } from 'react'

/** Calm, text-forward empty state for lists and panes. */
export function EmptyState({ title, hint }: { title: string; hint?: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-card/40 px-6 py-10 text-center">
      <p className="text-sm text-foreground">{title}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
