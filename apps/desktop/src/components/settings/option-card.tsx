import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface SettingsOptionCardProps {
  /** Whether this card's radio input is the chosen value. */
  selected: boolean
  /** Layout for the card's contents (column of icon+label, row of radio+text). */
  className?: string
  /** The radio input plus its visual content. */
  children: ReactNode
}

/**
 * One choice in a settings radio group: a label-as-card with the shared
 * selected/unselected border treatment, a hover wash, and a focus ring lifted
 * to the card whenever the radio inside it has keyboard focus (which also
 * covers `sr-only` inputs). Hosts own the inner layout via `className`.
 * (Adapted from Reflect Open's `SettingsOptionCard`.)
 */
export function SettingsOptionCard({
  selected,
  className,
  children,
}: SettingsOptionCardProps): ReactNode {
  return (
    <label
      className={cn(
        'flex cursor-pointer rounded-lg border transition-colors duration-100',
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
        selected ? 'border-primary bg-accent' : 'border-border hover:bg-secondary',
        className,
      )}
    >
      {children}
    </label>
  )
}
