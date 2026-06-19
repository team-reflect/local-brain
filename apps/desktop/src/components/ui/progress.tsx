import type { ComponentProps, ReactNode } from 'react'
import { Progress as ProgressPrimitive } from 'radix-ui'
import { cn } from '../../lib/utils'

/**
 * Progress bar (shadcn/ui pattern over `radix-ui`'s `Progress`). Radix supplies
 * `role="progressbar"` and the `aria-valuemin/max/now` wiring (omitting
 * `aria-valuenow` while indeterminate). Pass `value` (0–100) for a determinate
 * bar, or omit it (`undefined` / `null`) for an indeterminate pulse. Give it an
 * `aria-label` so the bar has an accessible name.
 */
function Progress({
  className,
  value,
  ...props
}: ComponentProps<typeof ProgressPrimitive.Root>): ReactNode {
  const indeterminate = value === null || value === undefined
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-accent', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          'h-full rounded-full bg-primary transition-[width] duration-200',
          indeterminate && 'w-full animate-pulse bg-primary/40',
        )}
        style={indeterminate ? undefined : { width: `${value}%` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
