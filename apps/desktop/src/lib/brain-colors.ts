import { BRAIN_COLOR_IDS, DEFAULT_BRAIN_COLOR, type BrainColor } from '@local-brain/core'

/**
 * The CSS value for each brain identity color. `indigo` tracks the app accent
 * (`--primary`) so the default brain matches the brand in light and dark; the
 * other eight are fixed values chosen to read on both surfaces. Colors are ids
 * (not raw hex) so the rendering can change globally without touching settings.
 */
const BRAIN_COLOR_CSS: Record<BrainColor, string> = {
  indigo: 'hsl(var(--primary))',
  blue: '#3b82f6',
  teal: '#14b8a6',
  green: '#22c55e',
  amber: '#f59e0b',
  orange: '#f97316',
  red: '#ef4444',
  pink: '#ec4899',
  purple: '#a855f7',
}

const BRAIN_COLOR_LABELS: Record<BrainColor, string> = {
  indigo: 'Indigo',
  blue: 'Blue',
  teal: 'Teal',
  green: 'Green',
  amber: 'Amber',
  orange: 'Orange',
  red: 'Red',
  pink: 'Pink',
  purple: 'Purple',
}

/** A picker entry: the color id, its display label, and its CSS value. */
export interface BrainColorOption {
  id: BrainColor
  label: string
  css: string
}

/** Every brain color as a picker option, in display order. */
export const BRAIN_COLOR_OPTIONS: BrainColorOption[] = BRAIN_COLOR_IDS.map((id) => ({
  id,
  label: BRAIN_COLOR_LABELS[id],
  css: BRAIN_COLOR_CSS[id],
}))

/** The CSS color for a brain color id; falls back to the default. */
export function brainColorCss(color: BrainColor | undefined): string {
  return BRAIN_COLOR_CSS[color ?? DEFAULT_BRAIN_COLOR]
}
