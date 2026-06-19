import type { ReactNode } from 'react'
import { Section } from '../../components/section'
import { useActiveBrain, useDatabasePath } from '../../lib/queries'

export function LocalDatabaseSettings(): ReactNode {
  const path = useDatabasePath()
  const active = useActiveBrain()
  return (
    <Section title="Local database">
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p>
          Each brain is a folder on this machine. This is the SQLite path inside the active
          brain{active.data ? ` (“${active.data.name}”)` : ''}; switch, create, and open brains
          from the sidebar brain switcher. Migrations run automatically when a brain is opened; the
          schema is versioned in the app.
        </p>
        <div className="rounded-md border border-border bg-card px-4 py-3 font-mono text-xs text-card-foreground break-all">
          {path.data ?? 'resolving…'}
        </div>
        <p className="text-xs">
          The app opens <code className="font-mono text-foreground">$BRAIN_ROOT</code> when set, or
          the last active brain folder. The <code className="font-mono text-foreground">brain</code>{' '}
          CLI also accepts <code className="font-mono text-foreground">--brain</code>;{' '}
          <code className="font-mono text-foreground">--db</code> remains an advanced override.
        </p>
      </div>
    </Section>
  )
}
