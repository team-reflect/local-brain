import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { appVersion, type BrainInfo } from '@local-brain/core'
import { Check, FolderOpen, Plus, SquareArrowOutUpRight } from 'lucide-react'
import { BrainDialog, type BrainDialogMode } from '../components/brain-dialog'
import { BrainSwatch } from '../components/brain-swatch'
import { Button } from '../components/button'
import { PageHead } from '../components/page-head'
import { Section } from '../components/section'
import { BRAIN_COLOR_OPTIONS } from '../lib/brain-colors'
import { cn } from '../lib/utils'
import { controlClass, sectionLabel } from '../lib/ui'
import {
  useActiveBrain,
  useBrains,
  useDatabasePath,
  useForgetBrain,
  useKeychainHas,
  useModelSettings,
  useModelStatus,
  useOpenBrain,
  useRenameBrain,
  useRevealBrain,
  useSetBrainColor,
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
  { key: 'brain', label: 'Brain' },
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
  const active = isSettingsSection(section) ? section : DEFAULT_SECTION

  useEffect(() => {
    if (!isSettingsSection(section)) return
    requestAnimationFrame(() => {
      document.getElementById(settingsSectionId(section))?.scrollIntoView?.({ block: 'start' })
    })
  }, [section])

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
            onClick={() => navigate({ kind: 'settings', section: s.key })}
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
    case 'brain':
      return <BrainSettings />
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

function formatMs(ms: number): string {
  return ms > 0 ? new Date(ms).toLocaleString() : '—'
}

function BrainSettings(): ReactNode {
  const active = useActiveBrain()
  const brains = useBrains()
  const rename = useRenameBrain()
  const setColor = useSetBrainColor()
  const forget = useForgetBrain()
  const openBrain = useOpenBrain()
  const reveal = useRevealBrain()
  const [dialog, setDialog] = useState<{ open: boolean; mode: BrainDialogMode }>({
    open: false,
    mode: 'create',
  })
  const [nameDraft, setNameDraft] = useState<string | null>(null)

  const brain = active.data
  const others = (brains.data ?? []).filter((entry) => !entry.isActive)
  const nameValue = nameDraft ?? brain?.name ?? ''
  const nameChanged = brain != null && nameValue.trim().length > 0 && nameValue.trim() !== brain.name

  function saveName(): void {
    if (brain && nameChanged) {
      rename.mutate({ path: brain.path, name: nameValue.trim() })
      setNameDraft(null)
    }
  }

  return (
    <Section title="Brain">
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-muted-foreground">
          A <strong className="font-medium text-foreground">brain</strong> is one local SQLite
          database — your top-level workspace. Switch between brains from the picker at the top of
          the sidebar. (The Network <em>Graph</em> is a different thing: a visualization of the
          records inside this brain.)
        </p>

        {brain ? (
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2.5">
              <BrainSwatch color={brain.color} className="size-5" />
              <span className="text-sm font-semibold text-foreground">{brain.name}</span>
              <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Check className="size-3.5 text-primary" aria-hidden />
                active
              </span>
            </div>

            <BrainField label="Name">
              <div className="flex items-center gap-2">
                <input
                  value={nameValue}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') saveName()
                  }}
                  className={controlClass}
                />
                <Button variant="outline" disabled={!nameChanged || rename.isPending} onClick={saveName}>
                  Save
                </Button>
              </div>
            </BrainField>

            <BrainField label="Color">
              <div className="flex flex-wrap gap-1.5">
                {BRAIN_COLOR_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-label={option.label}
                    aria-pressed={option.id === brain.color}
                    title={option.label}
                    onClick={() => setColor.mutate({ path: brain.path, color: option.id })}
                    className={cn(
                      'flex size-6 items-center justify-center rounded-md ring-2 ring-offset-1 ring-offset-card transition-colors',
                      option.id === brain.color ? 'ring-ring' : 'ring-transparent hover:ring-border',
                    )}
                  >
                    <span
                      aria-hidden
                      className="size-4 rounded-[4px]"
                      style={{ backgroundColor: option.css }}
                    />
                  </button>
                ))}
              </div>
            </BrainField>

            <BrainField label="Location">
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-card-foreground">
                  {brain.path}
                </code>
                <Button variant="ghost" onClick={() => reveal.mutate(brain.path)} aria-label="Reveal in file manager">
                  <SquareArrowOutUpRight className="size-3.5" aria-hidden />
                  Reveal
                </Button>
              </div>
            </BrainField>

            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">Schema</dt>
              <dd className="font-mono text-foreground">
                {brain.schemaVersion != null ? `v${brain.schemaVersion}` : '—'}
              </dd>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="font-mono text-foreground">{formatMs(brain.createdMs)}</dd>
              <dt className="text-muted-foreground">Last opened</dt>
              <dd className="font-mono text-foreground">{formatMs(brain.lastOpenedMs)}</dd>
            </dl>
          </div>
        ) : (
          <p className="text-muted-foreground">No active brain.</p>
        )}

        <div className="flex flex-col gap-2">
          <span className={sectionLabel}>All brains</span>
          {others.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              This is your only brain. Create or open another to switch between them.
            </p>
          ) : (
            <ul className="flex flex-col gap-px">
              {others.map((entry: BrainInfo) => (
                <li
                  key={entry.path}
                  className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-secondary/60"
                >
                  <BrainSwatch color={entry.color} className="size-4" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{entry.name}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">{entry.path}</span>
                  </span>
                  <Button variant="outline" onClick={() => openBrain.mutate(entry.path)}>
                    Switch
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => forget.mutate(entry.path)}
                    aria-label={`Forget ${entry.name}`}
                  >
                    Forget
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex gap-2">
          <Button variant="primary" onClick={() => setDialog({ open: true, mode: 'create' })}>
            <Plus className="size-4" aria-hidden />
            New brain…
          </Button>
          <Button variant="outline" onClick={() => setDialog({ open: true, mode: 'open' })}>
            <FolderOpen className="size-4" aria-hidden />
            Open another brain…
          </Button>
        </div>
      </div>

      <BrainDialog
        open={dialog.open}
        mode={dialog.mode}
        onClose={() => setDialog((current) => ({ ...current, open: false }))}
      />
    </Section>
  )
}

function BrainField({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <label className="flex flex-col gap-1">
      <span className={sectionLabel}>{label}</span>
      {children}
    </label>
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
  const active = useActiveBrain()
  return (
    <Section title="Local database">
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p>
          Each brain is a single SQLite database on this machine. This is the path of the active
          brain{active.data ? ` (“${active.data.name}”)` : ''}; manage and switch brains under{' '}
          <strong className="font-medium text-foreground">Settings → Brain</strong>. Migrations run
          automatically when a brain is opened; the schema is versioned in the app.
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
  const active = useActiveBrain()
  const brains = useBrains()

  const brainCount = brains.data?.length
  const lines: [string, string][] = [
    ['app', info.data ? `${info.data.name} v${info.data.version} · ${info.data.platform}` : '…'],
    [
      'brain',
      active.data
        ? `${active.data.name}${active.data.schemaVersion != null ? ` · schema v${active.data.schemaVersion}` : ''}` +
          (brainCount ? ` · ${brainCount} known` : '')
        : '…',
    ],
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
