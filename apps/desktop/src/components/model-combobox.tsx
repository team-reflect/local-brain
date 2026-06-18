import type { ReactNode } from 'react'
import type { AiModelOption } from '@local-brain/core'
import { controlClass } from '../lib/ui'

/**
 * Reflect-style model picker: choose from the curated provider list, while still
 * allowing a manually typed model id when a provider ships something new.
 */
export function ModelCombobox({
  id,
  value,
  models,
  onChange,
}: {
  id: string
  value: string
  models: readonly AiModelOption[]
  onChange: (value: string) => void
}): ReactNode {
  const listId = `${id}-options`
  return (
    <>
      <input
        id={id}
        list={listId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${controlClass} font-mono text-xs`}
      />
      <datalist id={listId}>
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))}
      </datalist>
    </>
  )
}
