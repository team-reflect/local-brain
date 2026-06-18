import type { ReactNode } from 'react'
import { cn } from '../lib/utils'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-secondary text-secondary-foreground',
  accent: 'bg-accent text-accent-foreground',
  success: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  danger: 'bg-destructive/12 text-destructive',
}

/** A Reflect pill badge: small, full-radius, soft-tinted. For status/kind/state. */
export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone
  className?: string
  children: ReactNode
}): ReactNode {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-tight whitespace-nowrap',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Semantic tone per record status, mapped once so screens never invent their own. */
const STATUS_TONE: Record<string, BadgeTone> = {
  open: 'neutral',
  active: 'accent',
  in_progress: 'accent',
  waiting: 'warning',
  blocked: 'warning',
  scheduled: 'accent',
  paused: 'neutral',
  done: 'success',
  completed: 'success',
  archived: 'neutral',
  cancelled: 'neutral',
}

function titleCase(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** A status pill that derives its tone from a known status string. */
export function StatusBadge({ status }: { status: string }): ReactNode {
  const tone = STATUS_TONE[status.toLowerCase()] ?? 'neutral'
  return <Badge tone={tone}>{titleCase(status)}</Badge>
}
