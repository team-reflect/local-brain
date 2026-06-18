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
  navigate: (route: Route, options?: { replace?: boolean }) => void
  back: () => void
  forward: () => void
  canBack: boolean
  canForward: boolean
}

interface History {
  stack: Route[]
  index: number
}

const RouterContext = createContext<RouterValue | null>(null)

function initialRoute(): Route {
  if (typeof window === 'undefined') return HOME_ROUTE
  return routeFromPath(window.location.pathname + window.location.search)
}

/**
 * In-memory history stack (Reflect Open's pattern) with a cursor for
 * back/forward. The active route is mirrored to `window.history` so deep links
 * and the browser back/forward buttons stay in sync; `popstate` re-reads the URL.
 */
export function RouterProvider({ children }: { children: ReactNode }): ReactElement {
  const [history, setHistory] = useState<History>(() => ({ stack: [initialRoute()], index: 0 }))
  const suppressPopstate = useRef(false)
  const historyWriteMode = useRef<'push' | 'replace'>('push')

  const route = history.stack[history.index] ?? HOME_ROUTE

  const navigate = useCallback((next: Route, options: { replace?: boolean } = {}) => {
    setHistory((current) => {
      const active = current.stack[current.index]
      if (active && routesEqual(active, next)) return current
      if (options.replace) {
        historyWriteMode.current = 'replace'
        const stack = [...current.stack]
        stack[current.index] = next
        return { stack, index: current.index }
      }
      historyWriteMode.current = 'push'
      const stack = [...current.stack.slice(0, current.index + 1), next]
      return { stack, index: stack.length - 1 }
    })
  }, [])

  const back = useCallback(() => {
    setHistory((current) =>
      current.index > 0 ? { ...current, index: current.index - 1 } : current,
    )
  }, [])

  const forward = useCallback(() => {
    setHistory((current) =>
      current.index < current.stack.length - 1
        ? { ...current, index: current.index + 1 }
        : current,
    )
  }, [])

  // Keep the address/history in sync with the active route.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const path = routeToPath(route)
    if (window.location.pathname + window.location.search !== path) {
      suppressPopstate.current = true
      if (historyWriteMode.current === 'replace') {
        window.history.replaceState({}, '', path)
      } else {
        window.history.pushState({}, '', path)
      }
    }
    historyWriteMode.current = 'push'
  }, [route])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onPopstate = () => {
      if (suppressPopstate.current) {
        suppressPopstate.current = false
        return
      }
      navigate(routeFromPath(window.location.pathname + window.location.search))
    }
    window.addEventListener('popstate', onPopstate)
    return () => window.removeEventListener('popstate', onPopstate)
  }, [navigate])

  const value = useMemo<RouterValue>(
    () => ({
      route,
      navigate,
      back,
      forward,
      canBack: history.index > 0,
      canForward: history.index < history.stack.length - 1,
    }),
    [route, navigate, back, forward, history.index, history.stack.length],
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
