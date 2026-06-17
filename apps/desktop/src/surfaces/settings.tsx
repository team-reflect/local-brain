import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { appVersion } from '@local-brain/core'
import { PageHead } from '../components/page-head'
import { Section } from '../components/section'

/** Settings shell. Model keys, backup/export, and skill setup arrive in Plan 08. */
export function SettingsSurface(): ReactNode {
  const info = useQuery({ queryKey: ['app-version'], queryFn: appVersion })

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-7">
      <PageHead eyebrow="Settings" title="Settings" />
      <Section title="Diagnostics">
        <div className="rounded-md border border-border bg-card px-4 py-3 font-mono text-xs text-card-foreground">
          {info.data ? (
            <span>
              {info.data.name} v{info.data.version} · {info.data.platform}
            </span>
          ) : (
            <span className="text-muted-foreground">Loading app info…</span>
          )}
        </div>
      </Section>
      <Section title="Coming in Plan 08">
        <p className="text-sm text-muted-foreground">
          Model keys, local database path, backup &amp; export, and skill setup.
        </p>
      </Section>
    </div>
  )
}
