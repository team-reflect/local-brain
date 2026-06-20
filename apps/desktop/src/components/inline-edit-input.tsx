import type { ComponentProps, ReactNode } from 'react'
import { inlineControlClass, InlineEditableField } from './inline-edit-field'
import { Input } from './ui/input'
import { cn } from '../lib/utils'

interface InlineEditableInputProps
  extends Pick<ComponentProps<'input'>, 'type' | 'placeholder'> {
  label: string
  value: string
  display?: ReactNode
  isEditing: boolean
  onEdit: () => void
  onChange: (value: string) => void
  onBlur: () => void
  muted?: boolean
  ariaInvalid?: boolean
  inputClassName?: string | undefined
  displayClassName?: string | undefined
}

export function InlineEditableInput({
  label,
  value,
  display = value,
  isEditing,
  onEdit,
  onChange,
  onBlur,
  type = 'text',
  placeholder,
  muted = false,
  ariaInvalid,
  inputClassName,
  displayClassName,
}: InlineEditableInputProps): ReactNode {
  return (
    <InlineEditableField
      label={label}
      display={display}
      isEditing={isEditing}
      onEdit={onEdit}
      muted={muted}
      displayClassName={displayClassName}
    >
      <Input
        autoFocus
        aria-label={label}
        aria-invalid={ariaInvalid ? true : undefined}
        type={type}
        placeholder={placeholder}
        value={value}
        onBlur={onBlur}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={cn(inlineControlClass, inputClassName)}
      />
    </InlineEditableField>
  )
}
