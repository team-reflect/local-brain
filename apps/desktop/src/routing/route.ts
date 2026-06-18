/**
 * The typed route model. Routes are a discriminated union (Reflect Open's
 * pattern); every surface and detail page is one `kind`. Routes serialize to a
 * URL path + query so they are deep-linkable and survive history navigation,
 * and parse back with `routeFromPath`. `normalizeRoute` collapses anything
 * unrecognized to Today.
 */
export type Route =
  | { kind: 'today' }
  | { kind: 'tasks' }
  | { kind: 'network'; tab: 'graph' | 'people' | 'organizations' }
  | { kind: 'person'; id: string }
  | { kind: 'organization'; id: string }
  | { kind: 'projects' }
  | { kind: 'project'; id: string }
  | { kind: 'task'; id: string }
  | { kind: 'document'; id: string }
  | { kind: 'interaction'; id: string }
  | { kind: 'ask'; conversationId?: string }
  | { kind: 'settings'; section?: string }

export const HOME_ROUTE: Route = { kind: 'today' }

/** Structural equality, so the router can skip no-op navigations. */
export function routesEqual(a: Route, b: Route): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'network':
      return a.tab === (b as Extract<Route, { kind: 'network' }>).tab
    case 'person':
    case 'organization':
    case 'project':
    case 'task':
    case 'document':
    case 'interaction':
      return a.id === (b as { id: string }).id
    case 'ask':
      return a.conversationId === (b as Extract<Route, { kind: 'ask' }>).conversationId
    case 'settings':
      return a.section === (b as Extract<Route, { kind: 'settings' }>).section
    default:
      return true
  }
}

/** Serialize a route to a `/path?query` string. */
export function routeToPath(route: Route): string {
  switch (route.kind) {
    case 'today':
      return '/today'
    case 'tasks':
      return '/tasks'
    case 'network':
      return `/network?tab=${route.tab}`
    case 'person':
      return `/people/${encodeURIComponent(route.id)}`
    case 'organization':
      return `/organizations/${encodeURIComponent(route.id)}`
    case 'projects':
      return '/projects'
    case 'project':
      return `/projects/${encodeURIComponent(route.id)}`
    case 'task':
      return `/tasks/${encodeURIComponent(route.id)}`
    case 'document':
      return `/documents/${encodeURIComponent(route.id)}`
    case 'interaction':
      return `/interactions/${encodeURIComponent(route.id)}`
    case 'ask':
      return route.conversationId
        ? `/ask?conversation=${encodeURIComponent(route.conversationId)}`
        : '/ask'
    case 'settings':
      return route.section ? `/settings?section=${encodeURIComponent(route.section)}` : '/settings'
  }
}

/** Parse a `/path?query` string back into a route, defaulting to Today. */
export function routeFromPath(pathWithQuery: string): Route {
  const [rawPath = '', rawQuery = ''] = pathWithQuery.split('?')
  const segments = rawPath.split('/').filter(Boolean)
  const query = new URLSearchParams(rawQuery)
  const [head, id] = segments

  switch (head) {
    case undefined:
    case 'today':
      return { kind: 'today' }
    case 'tasks':
      return id ? { kind: 'task', id: decodeURIComponent(id) } : { kind: 'tasks' }
    case 'network': {
      const tab = query.get('tab')
      if (tab === 'people' || tab === 'organizations') return { kind: 'network', tab }
      return { kind: 'network', tab: 'graph' }
    }
    case 'people':
      return id ? { kind: 'person', id: decodeURIComponent(id) } : { kind: 'network', tab: 'people' }
    case 'organizations':
      return id
        ? { kind: 'organization', id: decodeURIComponent(id) }
        : { kind: 'network', tab: 'organizations' }
    case 'projects':
      return id ? { kind: 'project', id: decodeURIComponent(id) } : { kind: 'projects' }
    case 'documents':
      return id ? { kind: 'document', id: decodeURIComponent(id) } : { kind: 'today' }
    case 'interactions':
      return id ? { kind: 'interaction', id: decodeURIComponent(id) } : { kind: 'today' }
    case 'graph':
      return { kind: 'network', tab: 'graph' }
    case 'ask': {
      const conversationId = query.get('conversation')
      return conversationId ? { kind: 'ask', conversationId } : { kind: 'ask' }
    }
    case 'settings': {
      const section = query.get('section')
      return section ? { kind: 'settings', section } : { kind: 'settings' }
    }
    default:
      return { kind: 'today' }
  }
}

/** Which sidebar section a route belongs to (for active-state highlighting). */
export function sectionForRoute(route: Route): string {
  switch (route.kind) {
    case 'today':
      return 'today'
    case 'tasks':
    case 'task':
      return 'tasks'
    case 'network':
    case 'person':
    case 'organization':
      return 'network'
    case 'projects':
    case 'project':
      return 'projects'
    case 'document':
    case 'interaction':
      return 'today'
    case 'ask':
      return 'ask'
    case 'settings':
      return 'settings'
  }
}
