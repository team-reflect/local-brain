import type { ReactNode } from 'react'
import type { BrainColor } from '@local-brain/core'
import { brainColorCss } from '../lib/brain-colors'
import { cn } from '../lib/utils'

interface BrainSwatchProps {
  /** The brain's identity color; omitted renders the default (app accent). */
  color?: BrainColor | undefined
  /** Size / shape overrides — the swatch has no intrinsic dimensions. */
  className?: string
}

/**
 * A brain's identity color as a small rounded square — the visual anchor for
 * "which brain is this" in the sidebar switcher, the brain list, and the color
 * picker. Decorative: always paired with the brain's name.
 */
export function BrainSwatch({ color, className }: BrainSwatchProps): ReactNode {
  return (
    <span
      aria-hidden
      className={cn('inline-block flex-none rounded-[4px]', className)}
      style={{ backgroundColor: brainColorCss(color) }}
    />
  )
}
