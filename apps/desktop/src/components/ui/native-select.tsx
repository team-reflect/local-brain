import type { ComponentProps, ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { controlClass } from '../../lib/ui'
import { cn } from '../../lib/utils'

/**
 * A styled native `<select>` (shadcn/ui "Native Select", house style). Keeps the
 * platform dropdown — right for a short, static option list — while matching the
 * `controlClass` field chrome and swapping the OS arrow for a calm lucide chevron.
 * Pass `<option>`s as children.
 */
function NativeSelect({ className, children, ...props }: ComponentProps<'select'>): ReactNode {
  return (
    <div data-slot="native-select" className="relative">
      <select className={cn(controlClass, 'cursor-pointer appearance-none pr-8', className)} {...props}>
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}

export { NativeSelect }
