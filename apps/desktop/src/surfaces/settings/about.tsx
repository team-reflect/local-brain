import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { appVersion } from '@local-brain/core'
import { SettingsSection } from '../../components/settings/section'
import { useUpdate } from '../../providers/update-provider'
import { UpdateField } from './update-field'

export function AboutSettings(): ReactNode {
  const info = useQuery({ queryKey: ['app-version'], queryFn: appVersion })
  const { supported } = useUpdate()

  return (
    <SettingsSection id="about">
      <div className="flex items-start justify-between gap-4 px-4 py-3.5">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">Local Brain</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Local Brain is a private, local-first, personal knowledge graph.
          </p>
        </div>
        <span className="shrink-0 text-sm text-muted-foreground">
          {info.data ? `v${info.data.version}` : '—'}
        </span>
      </div>
      {supported ? <UpdateField /> : null}
    </SettingsSection>
  )
}
