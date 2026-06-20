import type { ReactNode } from 'react'
import { inlineControlClass, InlineEditableField } from './inline-edit-field'
import { Textarea } from './ui/textarea'
import { cn } from '../lib/utils'

interface InlineEditableTextareaProps {
  label: string
  value: string
  display?: ReactNode
  isEditing: boolean
  onEdit: () => void
  onChange: (value: string) => void
  onBlur: () => void
  rows?: number
  muted?: boolean
  ariaInvalid?: boolean
  inputClassName?: string | undefined
  displayClassName?: string | undefined
}

export function InlineEditableTextarea({
  label,
  value,
  display = value,
  isEditing,
  onEdit,
  onChange,
  onBlur,
  rows,
  muted = false,
  ariaInvalid,
  inputClassName,
  displayClassName,
}: InlineEditableTextareaProps): ReactNode {
  return (
    <InlineEditableField
      label={label}
      display={display}
      isEditing={isEditing}
      onEdit={onEdit}
      muted={muted}
      multiline
      displayClassName={displayClassName}
    >
      <Textarea
        autoFocus
        aria-label={label}
        aria-invalid={ariaInvalid ? true : undefined}
        rows={rows}
        value={value}
        onBlur={onBlur}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={cn(inlineControlClass, 'min-h-16', inputClassName)}
      />
    </InlineEditableField>
  )
}
