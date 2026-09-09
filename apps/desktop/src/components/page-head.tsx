import type { ReactNode } from 'react'
import { sectionLabel } from '../lib/ui'

/** Route header with a readable title and actions that wrap in narrow panes. */
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
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
      <div className="min-w-0 flex-1 basis-48">
        {eyebrow ? <p className={sectionLabel}>{eyebrow}</p> : null}
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-balance text-foreground [overflow-wrap:anywhere]">
          {title}
        </h1>
      </div>
      {actions ? <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
