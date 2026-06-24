import type { ReactNode } from 'react'

interface SettingsFieldProps {
  /** The control's name, shown above it. */
  legend: string
  /** Optional one-line explanation under the legend. */
  description?: string
  /** The control itself (option cards, inputs, buttons). */
  children: ReactNode
}

/**
 * One labelled control inside a {@link SettingsSection} card: a legend and
 * optional help text sharing the settings page's type treatment, then the
 * control. Every section renders its controls through this so the row rhythm
 * stays uniform. (Adapted from Reflect Open's `SettingsField`.)
 */
export function SettingsField({ legend, description, children }: SettingsFieldProps): ReactNode {
  return (
    <div className="px-4 py-3.5">
      <div className="text-sm font-medium text-foreground">{legend}</div>
      {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      {children}
    </div>
  )
}
