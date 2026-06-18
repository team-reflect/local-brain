import type { ReactNode } from 'react'

/** A titled content block used across surfaces and detail pages. */
export function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}): ReactNode {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-medium tracking-wide text-muted-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
