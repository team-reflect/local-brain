import type { ReactNode } from 'react'
import { cn } from '../lib/utils'

export type AlertVariant = 'error' | 'success' | 'info' | 'warning'

const VARIANT: Record<AlertVariant, string> = {
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
  success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  info: 'border-border bg-secondary/40 text-foreground',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
}

/**
 * A small inline status box for form errors, notices, and confirmations. One
 * place owns the border/background/padding so error and success messages look
 * the same wherever they appear (dialogs, settings).
 */
export function Alert({
  variant = 'info',
  className,
  children,
}: {
  variant?: AlertVariant
  className?: string
  children: ReactNode
}): ReactNode {
  return (
    <p className={cn('rounded-md border px-3 py-2 text-xs', VARIANT[variant], className)}>
      {children}
    </p>
  )
}
