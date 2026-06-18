import type { ReactNode } from 'react'

/** Route-level header: an eyebrow label, a serif title, and optional actions. */
export function PageHead({
  eyebrow,
  title,
  actions,
}: {
  eyebrow?: string
  title: string
  actions?: ReactNode
}): ReactNode {
  return (
    <header className="flex items-end justify-between gap-4 border-b border-border pb-3">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground">{eyebrow}</p>
        ) : null}
        <h1 className="mt-1 truncate text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}
