import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { appVersion } from '@local-brain/core'
import { Section } from '../../components/section'

export function AboutSettings(): ReactNode {
  const info = useQuery({ queryKey: ['app-version'], queryFn: appVersion })

  return (
    <Section title="About">
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Local Brain is a private, local-first, personal knowledge graph.
        </p>
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5">
          <div className="contents">
            <dt className="text-muted-foreground">Version</dt>
            <dd className="text-foreground">{info.data ? `v${info.data.version}` : '...'}</dd>
          </div>
        </dl>
      </div>
    </Section>
  )
}
