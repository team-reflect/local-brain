import type { ComponentProps, ReactNode } from 'react'
import { controlClass } from '../../lib/ui'
import { cn } from '../../lib/utils'

/**
 * Standard text field (shadcn/ui `Input`, house style). Wraps the design-system
 * `controlClass` — bordered white field, indigo focus ring — so every text input
 * shares one source of truth, and layers on `aria-invalid` error styling for
 * inline form validation. React 19 forwards `ref` as a normal prop.
 */
function Input({ className, type = 'text', ...props }: ComponentProps<'input'>): ReactNode {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        controlClass,
        'aria-invalid:border-destructive aria-invalid:focus:border-destructive aria-invalid:focus:ring-destructive/25',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
