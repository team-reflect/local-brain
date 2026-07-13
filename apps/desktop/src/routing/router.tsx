import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { HOME_ROUTE, type Route, routeFromPath, routesEqual, routeToPath } from './route'

interface RouterValue {
  route: Route
  navigate: (route: Route) => void
  back: () => void
  forward: () => void
  canBack: boolean
  canForward: boolean
  entryKey: string
  navigationType: NavigationType
}

export type NavigationType = 'initial' | 'push' | 'pop' | 'replace'

interface HistoryEntry {
  id: string
  route: Route
}

interface History {
  stack: HistoryEntry[]
  index: number
  navigationType: NavigationType
}

const RouterContext = createContext<RouterValue | null>(null)
const HISTORY_INDEX_KEY = '__localBrainHistoryIndex'
const HISTORY_ENTRY_KEY = '__localBrainHistoryEntry'
const HISTORY_SESSION_KEY = '__localBrainHistorySession'
let routerId = 0

interface BrowserHistoryMarker {
  index: number
  entryId: string
  sessionId: string
}

function nextRouterId(prefix: 'entry' | 'session'): string {
  routerId += 1
  return `${prefix}-${Date.now().toString(36)}-${routerId.toString(36)}`
}

function browserHistoryMarker(state: unknown): BrowserHistoryMarker | null {
  if (typeof state !== 'object' || state === null || Array.isArray(state)) return null
  const record = state as Record<string, unknown>
  const index = record[HISTORY_INDEX_KEY]
  const entryId = record[HISTORY_ENTRY_KEY]
  const sessionId = record[HISTORY_SESSION_KEY]
  if (
    typeof index !== 'number' ||
    !Number.isInteger(index) ||
    index < 0 ||
    typeof entryId !== 'string' ||
    typeof sessionId !== 'string'
  ) {
    return null
  }
  return { index, entryId, sessionId }
}

function browserStateAt(
  marker: BrowserHistoryMarker,
  state: unknown,
): Record<string, unknown> {
  const base =
    typeof state === 'object' && state !== null && !Array.isArray(state)
      ? (state as Record<string, unknown>)
      : {}
  return {
    ...base,
    [HISTORY_INDEX_KEY]: marker.index,
    [HISTORY_ENTRY_KEY]: marker.entryId,
    [HISTORY_SESSION_KEY]: marker.sessionId,
  }
}

function initialRoute(): Route {
  if (typeof window === 'undefined') return HOME_ROUTE
  return routeFromPath(window.location.pathname + window.location.search)
}

/**
 * In-memory history stack (Reflect Open's pattern) with a cursor and isolated
 * workspace session. The active route is mirrored to `window.history` so deep
 * links and browser back/forward stay in sync without stale workspace entries
 * colliding with a fresh stack.
 */
export function RouterProvider({ children }: { children: ReactNode }): ReactElement {
  const [initialSessionId] = useState(() => nextRouterId('session'))
  const sessionIdRef = useRef(initialSessionId)
  const [history, setHistory] = useState<History>(() => ({
    stack: [{ id: nextRouterId('entry'), route: initialRoute() }],
    index: 0,
    navigationType: 'initial',
  }))
  const historyRef = useRef(history)
  const browserHistoryInitialized = useRef(false)

  const activeEntry = history.stack[history.index]
  const route = activeEntry?.route ?? HOME_ROUTE
  const entryKey = `${sessionIdRef.current}:${activeEntry?.id ?? 'home'}`

  const commitHistory = useCallback((next: History): void => {
    historyRef.current = next
    setHistory(next)
  }, [])

  const initializeBrowserHistory = useCallback((): void => {
    if (typeof window === 'undefined' || browserHistoryInitialized.current) return
    const entry = historyRef.current.stack[0] ?? { id: nextRouterId('entry'), route: HOME_ROUTE }
    window.history.replaceState(
      browserStateAt(
        { index: 0, entryId: entry.id, sessionId: sessionIdRef.current },
        window.history.state,
      ),
      '',
      routeToPath(entry.route),
    )
    browserHistoryInitialized.current = true
  }, [])

  const navigate = useCallback((next: Route) => {
    const current = historyRef.current
    const active = current.stack[current.index]
    if (active && routesEqual(active.route, next)) return

    const entry = { id: nextRouterId('entry'), route: next }
    const stack = [...current.stack.slice(0, current.index + 1), entry]
    const nextHistory: History = { stack, index: stack.length - 1, navigationType: 'push' }
    if (typeof window !== 'undefined') {
      initializeBrowserHistory()
      window.history.pushState(
        browserStateAt(
          {
            index: nextHistory.index,
            entryId: entry.id,
            sessionId: sessionIdRef.current,
          },
          window.history.state,
        ),
        '',
        routeToPath(next),
      )
    }
    commitHistory(nextHistory)
  }, [commitHistory, initializeBrowserHistory])

  const back = useCallback(() => {
    if (historyRef.current.index > 0 && typeof window !== 'undefined') {
      window.history.back()
    }
  }, [])

  const forward = useCallback(() => {
    const current = historyRef.current
    if (current.index < current.stack.length - 1 && typeof window !== 'undefined') {
      window.history.forward()
    }
  }, [])

  // Mark the entry that launched this workspace without adding a duplicate URL
  // to the browser stack. Later entries receive their internal cursor in
  // `navigate`, so Back/Forward popstate events can restore them unambiguously.
  useEffect(() => {
    initializeBrowserHistory()
  }, [initializeBrowserHistory])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onPopstate = (event: PopStateEvent): void => {
      const nextRoute = routeFromPath(window.location.pathname + window.location.search)
      const marker = browserHistoryMarker(event.state)
      const current = historyRef.current
      const markedEntry = marker ? current.stack[marker.index] : undefined
      if (
        marker !== null &&
        marker.sessionId === sessionIdRef.current &&
        markedEntry?.id === marker.entryId &&
        routesEqual(markedEntry.route, nextRoute)
      ) {
        commitHistory({ ...current, index: marker.index, navigationType: 'pop' })
        return
      }

      // An unmarked or stale-session entry can appear after a reload, workspace
      // switch, or provider remount. Adopt its URL as a new isolated history
      // root so an old numeric cursor can never collide with this workspace.
      sessionIdRef.current = nextRouterId('session')
      const entry = { id: nextRouterId('entry'), route: nextRoute }
      const nextHistory: History = {
        stack: [entry],
        index: 0,
        navigationType: 'replace',
      }
      window.history.replaceState(
        browserStateAt(
          { index: 0, entryId: entry.id, sessionId: sessionIdRef.current },
          event.state,
        ),
        '',
        routeToPath(nextRoute),
      )
      commitHistory(nextHistory)
    }
    window.addEventListener('popstate', onPopstate)
    return () => window.removeEventListener('popstate', onPopstate)
  }, [commitHistory])

  const value = useMemo<RouterValue>(
    () => ({
      route,
      navigate,
      back,
      forward,
      canBack: history.index > 0,
      canForward: history.index < history.stack.length - 1,
      entryKey,
      navigationType: history.navigationType,
    }),
    [
      route,
      navigate,
      back,
      forward,
      history.index,
      history.stack.length,
      history.navigationType,
      entryKey,
    ],
  )

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext)
  if (value === null) {
    throw new Error('useRouter must be used within a RouterProvider')
  }
  return value
}
