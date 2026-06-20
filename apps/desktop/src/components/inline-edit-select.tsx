import type { ReactNode } from 'react'
import { inlineControlClass, InlineEditableField } from './inline-edit-field'
import { NativeSelect } from './ui/native-select'
import { cn } from '../lib/utils'

interface InlineEditableSelectProps {
  label: string
  value: string
  display: ReactNode
  isEditing: boolean
  onEdit: () => void
  onChange: (value: string) => void
  onBlur: () => void
  children: ReactNode
  muted?: boolean
  ariaInvalid?: boolean
  selectClassName?: string | undefined
  displayClassName?: string | undefined
}

export function InlineEditableSelect({
  label,
  value,
  display,
  isEditing,
  onEdit,
  onChange,
  onBlur,
  children,
  muted = false,
  ariaInvalid,
  selectClassName,
  displayClassName,
}: InlineEditableSelectProps): ReactNode {
  return (
    <InlineEditableField
      label={label}
      display={display}
      isEditing={isEditing}
      onEdit={onEdit}
      muted={muted}
      displayClassName={displayClassName}
    >
      <NativeSelect
        autoFocus
        aria-label={label}
        aria-invalid={ariaInvalid ? true : undefined}
        value={value}
        onBlur={onBlur}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={cn(inlineControlClass, selectClassName)}
      >
        {children}
      </NativeSelect>
    </InlineEditableField>
  )
}
