import type { ReactNode } from 'react'
import { cn } from '../lib/utils'

interface InlineEditableFieldProps {
  label: string
  display: ReactNode
  isEditing: boolean
  onEdit: () => void
  children: ReactNode
  muted?: boolean
  multiline?: boolean
  displayClassName?: string | undefined
}

export const inlineControlClass = 'min-h-8 px-2 py-1.5 text-sm font-normal'

export function InlineEditableField({
  label,
  display,
  isEditing,
  onEdit,
  children,
  muted = false,
  multiline = false,
  displayClassName,
}: InlineEditableFieldProps): ReactNode {
  if (isEditing) {
    return (
      <label className="flex flex-col gap-1.5 text-xs font-medium text-[hsl(var(--lb-ink-2))]">
        {label}
        {children}
      </label>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[hsl(var(--lb-ink-2))]">{label}</span>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${label.toLowerCase()}`}
        className={cn(
          'flex min-h-8 w-full items-start justify-start rounded-md px-2 py-1.5 text-left text-sm font-normal text-foreground transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
          multiline && 'min-h-16 whitespace-pre-wrap',
          muted && 'text-muted-foreground',
          displayClassName,
        )}
      >
        <span className={cn('min-w-0', multiline && 'block w-full')}>{display}</span>
      </button>
    </div>
  )
}
