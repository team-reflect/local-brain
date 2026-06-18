import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { appVersion } from '@local-brain/core'
import { PageHead } from '../components/page-head'
import { Section } from '../components/section'
import { cn } from '../lib/utils'
import { useModelStatus } from '../lib/queries'
import { useRouter } from '../routing/router'

interface SettingsSection {
  key: string
  label: string
  /** The plan that ships the working version, shown as a quiet badge. */
  plan?: string
}

const SECTIONS: readonly SettingsSection[] = [
  { key: 'general', label: 'General' },
  { key: 'model-keys', label: 'Model keys' },
  { key: 'database', label: 'Local database' },
  { key: 'backup', label: 'Backup & export', plan: 'Plan 08' },
  { key: 'skills', label: 'Skills', plan: 'Plan 07' },
  { key: 'diagnostics', label: 'Diagnostics' },
]

const DEFAULT_SECTION = 'general'

export function SettingsSurface({ section }: { section: string | undefined }): ReactNode {
  const { navigate } = useRouter()
  const active = SECTIONS.some((s) => s.key === section) ? (section as string) : DEFAULT_SECTION

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col gap-4">
      <PageHead eyebrow="Settings" title="Settings" />
      <div className="flex min-h-0 flex-1 gap-6">
        <nav className="flex w-48 shrink-0 flex-col gap-0.5">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => navigate({ kind: 'settings', section: s.key })}
              className={cn(
                'flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                s.key === active
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/60',
              )}
            >
              {s.label}
              {s.plan ? (
                <span className="font-mono text-[9px] uppercase text-muted-foreground">soon</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          <SectionBody section={active} />
        </div>
      </div>
    </div>
  )
}

function SectionBody({ section }: { section: string }): ReactNode {
  switch (section) {
    case 'model-keys':
      return <ModelBoundary />
    case 'database':
      return (
        <Section title="Local database">
          <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p>
              Local Brain keeps everything in a single SQLite database on this machine. The path is
              resolved from <code className="font-mono text-foreground">$BRAIN_DB</code> when set,
              otherwise the platform data directory.
            </p>
            <p>Migrations run automatically at startup; the schema is versioned in the app.</p>
          </div>
        </Section>
      )
    case 'backup':
      return (
        <Section title="Backup &amp; export">
          <p className="text-sm text-muted-foreground">
            One-click database backup and a portable export of your records. Lands with the
            settings/backup work in Plan 08.
          </p>
        </Section>
      )
    case 'skills':
      return (
        <Section title="Skills">
          <p className="text-sm text-muted-foreground">
            Connect the <code className="font-mono text-foreground">brain</code> CLI and agent
            skills that read and write your brain from outside the app. Setup arrives with the CLI
            &amp; skills work in Plan 07.
          </p>
        </Section>
      )
    case 'diagnostics':
      return <Diagnostics />
    case 'general':
    default:
      return (
        <Section title="General">
          <p className="text-sm text-muted-foreground">
            Local Brain is a private, local-first personal CRM and knowledge base. Use the sidebar
            sections to browse your people, projects, tasks, and the records that connect them, or
            press <kbd className="font-mono text-foreground">⌘K</kbd> to search and run commands.
          </p>
        </Section>
      )
  }
}

function ModelBoundary(): ReactNode {
  const status = useModelStatus()
  const data = status.data
  return (
    <Section title="Model keys">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          Ask and model-backed extraction call your own provider key (BYOK). Keys are read from the
          OS keychain and never stored in app settings or sent anywhere but the provider you choose.
        </p>
        <div className="rounded-md border border-border bg-card px-4 py-3">
          {data ? (
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">External calls</dt>
              <dd className="font-mono text-foreground">{data.enabled ? 'enabled' : 'disabled'}</dd>
              <dt className="text-muted-foreground">Provider</dt>
              <dd className="font-mono text-foreground">{data.providerId ?? '—'}</dd>
              <dt className="text-muted-foreground">Model</dt>
              <dd className="font-mono text-foreground">{data.model ?? '—'}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd
                className={cn(
                  'font-mono',
                  data.canRun ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
                )}
              >
                {data.canRun ? 'ready' : 'not ready'}
              </dd>
              <dt className="text-muted-foreground">Detail</dt>
              <dd className="text-foreground">{data.reason}</dd>
            </dl>
          ) : (
            <span className="text-muted-foreground">Checking model status…</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Provider key management (keychain) and the enable/disable toggle ship with Settings &amp;
          privacy in Plan 08.
        </p>
      </div>
    </Section>
  )
}

function Diagnostics(): ReactNode {
  const info = useQuery({ queryKey: ['app-version'], queryFn: appVersion })
  const model = useModelStatus()
  return (
    <Section title="Diagnostics">
      <div className="flex flex-col gap-2">
        <div className="rounded-md border border-border bg-card px-4 py-3 font-mono text-xs text-card-foreground">
          {info.data ? (
            <span>
              {info.data.name} v{info.data.version} · {info.data.platform}
            </span>
          ) : (
            <span className="text-muted-foreground">Loading app info…</span>
          )}
        </div>
        <div className="rounded-md border border-border bg-card px-4 py-3 font-mono text-xs text-card-foreground">
          <span className="text-muted-foreground">model: </span>
          {model.data ? (model.data.canRun ? 'ready' : `unavailable (${model.data.reason})`) : '…'}
        </div>
        <div className="rounded-md border border-border bg-card px-4 py-3 font-mono text-xs text-card-foreground">
          <span className="text-muted-foreground">lexical search: </span>FTS5 (available)
          <span className="text-muted-foreground"> · semantic: </span>off (lexical fallback)
        </div>
      </div>
    </Section>
  )
}
