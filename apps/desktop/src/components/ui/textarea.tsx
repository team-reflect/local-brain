import type { ComponentProps, ReactNode } from 'react'
import { controlClass } from '../../lib/ui'
import { cn } from '../../lib/utils'

/**
 * Multi-line text field (shadcn/ui `Textarea`, house style). Shares the
 * `controlClass` chrome with {@link Input} so single- and multi-line fields match,
 * and defaults to a non-resizing box (the app's forms size with `rows` / `min-h`).
 */
function Textarea({ className, ...props }: ComponentProps<'textarea'>): ReactNode {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        controlClass,
        'resize-none',
        'aria-invalid:border-destructive aria-invalid:focus:border-destructive aria-invalid:focus:ring-destructive/25',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
