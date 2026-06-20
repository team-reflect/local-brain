import { useEffect, type ReactNode } from 'react'
import { AiProvidersSettings } from '../../components/ai-providers-settings'
import { cn } from '../../lib/utils'
import { useRouter } from '../../routing/router'
import { AboutSettings } from './about'
import { BrainSettings } from './brain'
import { SemanticSearchSettings } from './semantic-search'

interface SettingsSection {
  key: string
  label: string
}

const SECTIONS: readonly SettingsSection[] = [
  { key: 'about', label: 'About' },
  { key: 'brain', label: 'Brain' },
  { key: 'ai-providers', label: 'AI providers' },
  { key: 'search', label: 'Semantic search' },
]

const DEFAULT_SECTION = 'about'

function isSettingsSection(section: string | undefined): section is SettingsSection['key'] {
  return SECTIONS.some((s) => s.key === section)
}

function settingsSectionId(section: string): string {
  return `settings-${section}`
}

/**
 * The Settings surface: a sticky section rail plus a single scrollable column of
 * every section. Navigating to `?section=…` scrolls the matching block into view;
 * the rail highlights the requested section. Each section is its own component in
 * this directory.
 */
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
    <div
      aria-label="Settings"
      className="mx-auto grid max-w-5xl grid-cols-[11rem_minmax(0,1fr)] gap-x-8 gap-y-5 pb-10"
    >
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
    case 'ai-providers':
      return <AiProvidersSettings />
    case 'search':
      return <SemanticSearchSettings />
    case 'about':
    default:
      return <AboutSettings />
  }
}
