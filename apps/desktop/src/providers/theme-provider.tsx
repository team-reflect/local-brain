import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react'

/** The user's theme choice. `system` follows the OS appearance. */
export type ThemePreference = 'system' | 'light' | 'dark'

// Theme is an app-level preference, NOT per-brain: switching or creating a brain
// remounts the workspace, so a per-brain setting would reset the theme. We persist
// it in `localStorage`, which is scoped to the desktop webview origin (the
// install/profile) and shared across every brain DB — the same store the
// first-run flag uses.
const STORAGE_KEY = 'appearance.theme'

function readPreference(): ThemePreference {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
  } catch {
    return 'system'
  }
}

function systemPrefersDark(): boolean {
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

/** Toggle the `.dark` scope the design tokens key off (see globals.css). */
function applyTheme(preference: ThemePreference): void {
  const root = globalThis.document?.documentElement
  if (!root) {
    return
  }
  const dark = preference === 'dark' || (preference === 'system' && systemPrefersDark())
  root.classList.toggle('dark', dark)
}

// Apply the stored preference once at import — before React's first paint — so
// the window never flashes the light theme on launch for dark-mode users.
applyTheme(readPreference())

interface ThemeContextValue {
  theme: ThemePreference
  setTheme: (preference: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/**
 * Owns the theme preference: applies it to the document, persists it, and keeps
 * it in sync with the OS appearance while in `system` mode. Mounted once at the
 * app root.
 */
export function ThemeProvider({ children }: { children: ReactNode }): ReactNode {
  const [theme, setThemeState] = useState<ThemePreference>(() => readPreference())

  useLayoutEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    if (theme !== 'system') {
      return
    }
    const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) {
      return
    }
    const onChange = (): void => applyTheme('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])

  const setTheme = useCallback((preference: ThemePreference): void => {
    setThemeState(preference)
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, preference)
    } catch {
      // Best effort: if the store rejects the write, the choice still applies
      // for this session and simply isn't remembered next launch.
    }
  }, [])

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

/** Read and update the theme preference. Must be used within {@link ThemeProvider}. */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
