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
      <div>
        {eyebrow ? (
          <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-0.5 font-serif text-xl text-foreground">{title}</h1>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  )
}
