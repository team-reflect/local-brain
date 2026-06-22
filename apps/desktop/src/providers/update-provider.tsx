import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { hasBridge } from '@local-brain/core'
import {
  createUpdateController,
  type UpdateController,
  type UpdateState,
} from '../lib/update-controller'

interface UpdateContextValue {
  state: UpdateState
  supported: boolean
  checkNow: () => Promise<void>
  install: () => Promise<void>
  restart: () => Promise<void>
}

const DESKTOP_PLATFORMS = new Set(['darwin', 'windows', 'linux'])
const IDLE: UpdateState = { phase: 'idle' }
const UpdateContext = createContext<UpdateContextValue | null>(null)

function isDesktopBuild(): boolean {
  return DESKTOP_PLATFORMS.has(import.meta.env.TAURI_ENV_PLATFORM ?? '')
}

export function UpdateProvider({
  children,
  autoCheck,
}: {
  children: ReactNode
  autoCheck?: boolean
}): ReactNode {
  const supported = hasBridge() && isDesktopBuild()
  const resolvedAutoCheck = autoCheck ?? (supported && !import.meta.env.DEV)
  const [controller, setController] = useState<UpdateController | null>(null)

  useEffect(() => {
    if (!supported) return
    const next = createUpdateController({ autoCheck: resolvedAutoCheck })
    setController(next)
    next.start()
    return () => {
      next.dispose()
      setController((current) => (current === next ? null : current))
    }
  }, [resolvedAutoCheck, supported])

  const state = useSyncExternalStore(
    controller?.subscribe ?? (() => () => {}),
    controller?.getState ?? (() => IDLE),
  )

  const value = useMemo<UpdateContextValue>(
    () => ({
      state,
      supported,
      checkNow: () => controller?.checkNow() ?? Promise.resolve(),
      install: () => controller?.install() ?? Promise.resolve(),
      restart: () => controller?.restart() ?? Promise.resolve(),
    }),
    [controller, state, supported],
  )

  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>
}

export function useUpdate(): UpdateContextValue {
  const value = useContext(UpdateContext)
  if (value === null) throw new Error('useUpdate must be used within an UpdateProvider')
  return value
}
