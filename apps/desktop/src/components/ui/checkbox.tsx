import type { ComponentProps, ReactNode } from 'react'
import { Checkbox as CheckboxPrimitive } from 'radix-ui'
import { CheckIcon } from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * Checkbox (shadcn/ui pattern over `radix-ui`'s `Checkbox`). Replaces the raw
 * `<input type="checkbox">` controls that each picked their own indigo accent, so
 * every checkbox shares one square-with-indigo-fill style and a consistent focus
 * ring. Controlled via `checked` + `onCheckedChange`.
 */
function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>): ReactNode {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border border-input bg-card text-primary-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        <CheckIcon className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
