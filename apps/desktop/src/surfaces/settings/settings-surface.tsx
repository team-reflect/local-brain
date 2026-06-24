import { useEffect, useRef, type ReactNode } from 'react'
import { SettingsNavigator } from '../../components/settings/settings-navigator'
import { isSettingsSectionId } from '../../components/settings/sections'
import { scrollToSettingsSection } from '../../components/settings/section-scrolling'
import { AiProvidersSettings } from '../../components/ai-providers-settings'
import { AboutSettings } from './about'
import { AppearanceSettings } from './appearance'
import { BrainSettings } from './brain'
import { CliAgentsSettings } from './cli-agents'
import { DestructiveSettings } from './destructive-settings'
import { SemanticSearchSettings } from './semantic-search'

/**
 * The Settings surface: a sticky section rail beside a single scrollable column
 * of every section. The rail (see {@link SettingsNavigator}) tracks the section
 * you're reading and slides an accent marker to it; clicking an entry
 * smooth-scrolls to its card. Arriving via `?section=…` (deep links and the
 * command palette) scrolls that card into view on mount. Each section is its
 * own component in this directory; the danger zone sits below the navigated
 * sections in its own labelled region. (Layout/idiom adapted from Reflect Open.)
 */
export function SettingsSurface({ section }: { section: string | undefined }): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isSettingsSectionId(section)) return
    const anchor = rootRef.current
    if (!anchor) return
    // Wait a frame so the column has laid out before measuring the jump target.
    const frame = requestAnimationFrame(() => scrollToSettingsSection(anchor, section))
    return () => cancelAnimationFrame(frame)
  }, [section])

  return (
    <div
      ref={rootRef}
      aria-label="Settings"
      className="mx-auto grid max-w-5xl grid-cols-[11rem_minmax(0,1fr)] gap-x-8 pb-10"
    >
      <SettingsNavigator className="sticky top-0 h-fit self-start py-1" />
      <div className="flex min-w-0 flex-col gap-8">
        <AboutSettings />
        <AppearanceSettings />
        <BrainSettings />
        <AiProvidersSettings />
        <SemanticSearchSettings />
        <CliAgentsSettings />
        <DestructiveSettings />
      </div>
    </div>
  )
}
