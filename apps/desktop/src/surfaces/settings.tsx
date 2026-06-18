import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { appVersion } from '@local-brain/core'
import { PageHead } from '../components/page-head'
import { Section } from '../components/section'
import { cn } from '../lib/utils'
import {
  useDatabasePath,
  useKeychainHas,
  useModelSettings,
  useModelStatus,
  useSetModelEnabled,
  useSetProviderKey,
} from '../lib/queries'
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
  { key: 'skills', label: 'Skills' },
  { key: 'diagnostics', label: 'Diagnostics' },
]

const DEFAULT_SECTION = 'general'

function isSettingsSection(section: string | undefined): section is SettingsSection['key'] {
  return SECTIONS.some((s) => s.key === section)
}

function settingsSectionId(section: string): string {
  return `settings-${section}`
}

export function SettingsSurface({ section }: { section: string | undefined }): ReactNode {
  const { navigate } = useRouter()
  const [active, setActive] = useState<string>(isSettingsSection(section) ? section : DEFAULT_SECTION)

  useEffect(() => {
    if (!isSettingsSection(section)) return
    setActive(section)
    requestAnimationFrame(() => {
      document.getElementById(settingsSectionId(section))?.scrollIntoView?.({ block: 'start' })
    })
  }, [section])

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (!visible?.target.id) return
        const next = visible.target.id.replace(/^settings-/, '')
        if (isSettingsSection(next)) setActive(next)
      },
      { root: null, rootMargin: '-16% 0px -68% 0px', threshold: [0, 0.1, 1] },
    )

    for (const item of SECTIONS) {
      const element = document.getElementById(settingsSectionId(item.key))
      if (element) observer.observe(element)
    }

    return () => observer.disconnect()
  }, [])

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-[11rem_minmax(0,1fr)] gap-x-8 gap-y-5 pb-10">
      <div className="col-span-full">
        <PageHead eyebrow="Settings" title="Settings" />
      </div>
      <nav className="sticky top-0 flex h-fit flex-col gap-0.5 self-start border-l border-border py-1">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-current={s.key === active ? 'location' : undefined}
            onClick={() => {
              setActive(s.key)
              navigate({ kind: 'settings', section: s.key })
              document
                .getElementById(settingsSectionId(s.key))
                ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
            }}
            className={cn(
              'rounded-r-md border-l-2 px-3 py-1.5 text-left text-sm font-medium transition-colors',
              s.key === active
                ? '-ml-px border-primary text-foreground'
                : '-ml-px border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-col gap-7">
        {SECTIONS.map((s) => (
          <div key={s.key} id={settingsSectionId(s.key)} className="scroll-mt-5">
            <SectionBody section={s.key} />
          </div>
        ))}
      </div>
    </div>
  )
}

function SectionBody({ section }: { section: string }): ReactNode {
  switch (section) {
    case 'model-keys':
      return <ModelBoundary />
    case 'database':
      return <LocalDatabase />
    case 'skills':
      return <Skills />
    case 'diagnostics':
      return <Diagnostics />
    case 'general':
    default:
      return <General />
  }
}

function General(): ReactNode {
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

function Skills(): ReactNode {
  return (
    <Section title="Skills">
      <div className="flex flex-col gap-3 text-sm text-muted-foreground">
        <p>
          The <code className="font-mono text-foreground">brain</code> CLI is the supported agent
          interface — it reads and writes this same database from a terminal, with the app open or
          closed. It ships bundled with the app as a sidecar binary.
        </p>
        <div className="rounded-md border border-border bg-card px-4 py-3 font-mono text-xs text-card-foreground">
          <div>brain search "northwind" --json</div>
          <div>brain ask "what did we decide?" --json</div>
          <div>brain today --json</div>
          <div>brain add interaction --kind meeting --title "…" --text-file ./notes.md --json</div>
        </div>
        <p>
          The agent skill lives at{' '}
          <code className="font-mono text-foreground">skills/brain/SKILL.md</code>; point Codex (or
          another local agent) at it to teach safe read/write behavior. Sidecar detection and a
          one-click PATH install land with packaging in Plan 09.
        </p>
      </div>
    </Section>
  )
}

function ModelBoundary(): ReactNode {
  const status = useModelStatus()
  const settings = useModelSettings()
  const hasKey = useKeychainHas('anthropic')
  const setKey = useSetProviderKey()
  const setEnabled = useSetModelEnabled()
  const [draftKey, setDraftKey] = useState('')
  const data = status.data

  return (
    <Section title="Model keys">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          Ask and model-backed extraction call your own provider key (BYOK). The key is stored in the
          OS keychain — never in app settings — and is sent only to the provider you choose.
        </p>

        <div className="flex items-center gap-2">
          <input
            type="password"
            value={draftKey}
            onChange={(event) => setDraftKey(event.target.value)}
            placeholder={hasKey.data ? 'A key is stored — enter a new one to replace it' : 'sk-ant-…'}
            className="flex-1 rounded-md border border-border bg-card px-3 py-2 font-mono text-xs outline-none focus:border-primary/50"
          />
          <button
            type="button"
            disabled={setKey.isPending || draftKey.trim().length === 0}
            onClick={() => {
              setKey.mutate({ account: 'anthropic', secret: draftKey })
              setDraftKey('')
            }}
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-40"
          >
            Save key
          </button>
          {hasKey.data ? (
            <button
              type="button"
              disabled={setKey.isPending}
              onClick={() => setKey.mutate({ account: 'anthropic', secret: null })}
              className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary/60"
            >
              Clear
            </button>
          ) : null}
        </div>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={settings.data?.enabled ?? true}
            onChange={(event) => setEnabled.mutate(event.target.checked)}
          />
          Allow external model calls (master kill switch)
        </label>

        <div className="rounded-md border border-border bg-card px-4 py-3">
          {data ? (
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">Key stored</dt>
              <dd className="font-mono text-foreground">{hasKey.data ? 'yes (keychain)' : 'no'}</dd>
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
      </div>
    </Section>
  )
}

function LocalDatabase(): ReactNode {
  const path = useDatabasePath()
  return (
    <Section title="Local database">
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p>
          Local Brain keeps everything in a single SQLite database on this machine. Migrations run
          automatically at startup; the schema is versioned in the app.
        </p>
        <div className="rounded-md border border-border bg-card px-4 py-3 font-mono text-xs text-card-foreground break-all">
          {path.data ?? 'resolving…'}
        </div>
        <p className="text-xs">
          The path is resolved from <code className="font-mono text-foreground">$BRAIN_DB</code> when
          set, otherwise the platform data directory. The <code className="font-mono text-foreground">brain</code> CLI
          resolves it identically.
        </p>
      </div>
    </Section>
  )
}

function Diagnostics(): ReactNode {
  const info = useQuery({ queryKey: ['app-version'], queryFn: appVersion })
  const model = useModelStatus()
  const path = useDatabasePath()
  const hasKey = useKeychainHas('anthropic')

  const lines: [string, string][] = [
    ['app', info.data ? `${info.data.name} v${info.data.version} · ${info.data.platform}` : '…'],
    ['database', path.data ?? '…'],
    ['migrations', 'applied at startup (schema versioned)'],
    ['lexical search', 'FTS5 (available)'],
    ['semantic search', 'off (lexical fallback)'],
    ['keychain', hasKey.data === undefined ? '…' : hasKey.data ? 'anthropic key stored' : 'no provider key'],
    ['model', model.data ? (model.data.canRun ? 'ready' : `unavailable (${model.data.reason})`) : '…'],
    ['CLI / skill', 'brain sidecar bundled · skills/brain/SKILL.md'],
  ]

  return (
    <Section title="Diagnostics">
      <div className="rounded-lg border border-border bg-card px-4 py-3 font-mono text-xs text-card-foreground">
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5">
          {lines.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="break-all">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  )
}
