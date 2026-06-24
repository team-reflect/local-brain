import type { ReactNode } from 'react'
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { SettingsField } from '../../components/settings/field'
import { SettingsOptionCard } from '../../components/settings/option-card'
import { SettingsSection } from '../../components/settings/section'
import { cn } from '../../lib/utils'
import { useTheme, type ThemePreference } from '../../providers/theme-provider'

interface ThemeOption {
  value: ThemePreference
  label: string
  icon: LucideIcon
}

const THEME_OPTIONS: ThemeOption[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

/**
 * Theme picker as radio cards (Reflect's idiom). Writes the preference straight
 * to the {@link ThemeProvider}, which applies and persists it — there is no
 * save button.
 */
export function AppearanceSettings(): ReactNode {
  const { theme, setTheme } = useTheme()

  return (
    <SettingsSection id="appearance">
      <SettingsField
        legend="Theme"
        description="System follows your OS appearance. Saved on this device."
      >
        <div className="mt-3 grid grid-cols-3 gap-2">
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
            const selected = theme === value
            return (
              <SettingsOptionCard
                key={value}
                selected={selected}
                className={cn(
                  'flex-col items-center gap-1.5 px-3 py-3',
                  selected ? 'text-accent-foreground' : 'text-muted-foreground',
                )}
              >
                <input
                  type="radio"
                  name="theme"
                  value={value}
                  checked={selected}
                  onChange={() => setTheme(value)}
                  className="sr-only"
                />
                <Icon aria-hidden strokeWidth={1.75} className="size-4" />
                <span className="text-xs font-medium">{label}</span>
              </SettingsOptionCard>
            )
          })}
        </div>
      </SettingsField>
    </SettingsSection>
  )
}
