import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { scrollToSettingsSection } from './section-scrolling'
import { SETTINGS_SECTIONS, type SettingsSectionId } from './sections'
import { useActiveSettingsSection } from './use-active-settings-section'

/** Where the sliding marker sits, in the rail's own coordinates. */
interface MarkerPosition {
  top: number
  height: number
}

interface SettingsNavigatorProps {
  className?: string
}

/**
 * The sticky "on this page" rail beside the settings column: one entry per
 * registered section, with an accent marker that slides along a hairline track
 * to the section currently being read. Clicking an entry smooth-scrolls the
 * page to its card. (Adapted from Reflect Open's `SettingsNavigator`.)
 */
export function SettingsNavigator({ className }: SettingsNavigatorProps): ReactNode {
  const navRef = useRef<HTMLElement | null>(null)
  const itemRefs = useRef(new Map<SettingsSectionId, HTMLButtonElement>())
  const activeId = useActiveSettingsSection(navRef)
  const [marker, setMarker] = useState<MarkerPosition | null>(null)

  const measure = useCallback((): void => {
    const item = itemRefs.current.get(activeId)
    if (!item || item.offsetHeight === 0) {
      setMarker(null)
      return
    }
    setMarker({ top: item.offsetTop, height: item.offsetHeight })
  }, [activeId])

  useLayoutEffect(() => {
    measure()
  }, [measure])

  useEffect(() => {
    const nav = navRef.current
    if (!nav) {
      return
    }
    const resizeObserver = new ResizeObserver(() => measure())
    resizeObserver.observe(nav)
    return () => resizeObserver.disconnect()
  }, [measure])

  return (
    <nav ref={navRef} aria-label="Settings sections" className={cn('text-[13px]', className)}>
      <div className="relative flex flex-col border-l border-border">
        {marker !== null && (
          <span
            aria-hidden
            className="absolute -left-px top-0 w-0.5 rounded-full bg-primary transition-[transform,height] duration-200 ease-out motion-reduce:transition-none"
            style={{ transform: `translateY(${marker.top}px)`, height: `${marker.height}px` }}
          />
        )}
        {SETTINGS_SECTIONS.map((section) => {
          const isActive = section.id === activeId
          return (
            <button
              key={section.id}
              type="button"
              ref={(node) => {
                if (node) {
                  itemRefs.current.set(section.id, node)
                } else {
                  itemRefs.current.delete(section.id)
                }
              }}
              aria-current={isActive ? 'location' : undefined}
              onClick={() => {
                if (navRef.current) {
                  scrollToSettingsSection(navRef.current, section.id)
                }
              }}
              className={cn(
                'truncate rounded-r-md py-1 pl-4 pr-2 text-left outline-none transition-colors duration-200',
                'focus-visible:ring-2 focus-visible:ring-ring/50',
                isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {section.title}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
