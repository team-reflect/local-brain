import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/utils'

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive'
type ButtonSize = 'sm' | 'md'

const BASE =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50'

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-accent text-accent-foreground hover:bg-accent/70',
  outline: 'border border-border bg-card text-foreground hover:bg-secondary',
  ghost: 'text-muted-foreground hover:bg-secondary hover:text-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-8 px-3 text-sm',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  children?: ReactNode
}

/** The Reflect button: a single indigo solid action plus calm grey/outline/ghost siblings. */
export function Button({
  variant = 'outline',
  size = 'md',
  className,
  type = 'button',
  children,
  ...props
}: ButtonProps): ReactNode {
  return (
    <button type={type} className={cn(BASE, VARIANT[variant], SIZE[size], className)} {...props}>
      {children}
    </button>
  )
}
