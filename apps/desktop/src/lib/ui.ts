/**
 * Shared Reflect-style class strings. Centralising the recurring chrome (quiet
 * grey section labels, mono metadata, the standard input field) keeps surfaces
 * consistent and close to the design system without forking a component per use.
 *
 * Reflect conventions: section/field labels are small, medium-weight, calm grey,
 * sentence case (never uppercase). Mono is reserved for metadata — dates, counts,
 * statuses, IDs, and keyboard hints.
 */

/** Small, quiet label above a section or form field. */
export const sectionLabel = 'text-[11px] font-medium tracking-wide text-muted-foreground'

/** Mono metadata: dates, counts, statuses, IDs. */
export const metaText = 'font-mono text-[11px] text-muted-foreground'

/** Standard text input / textarea field. */
export const controlClass =
  'w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/25'

/** A monospace keyboard keycap (⌘K, ↩, etc.). */
export const keycapClass =
  'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm border border-border bg-secondary px-1 font-mono text-[10px] font-medium text-muted-foreground'
