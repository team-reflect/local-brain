import { describe, expect, it } from 'vitest'
import {
  routeFromPath,
  routesEqual,
  routeToPath,
  sectionForRoute,
  type Route,
} from './route'

const ROUTES: Route[] = [
  { kind: 'today' },
  { kind: 'tasks' },
  { kind: 'network', tab: 'graph' },
  { kind: 'network', tab: 'people' },
  { kind: 'network', tab: 'organizations' },
  { kind: 'person', id: '01ABC' },
  { kind: 'organization', id: 'org-1' },
  { kind: 'projects' },
  { kind: 'project', id: 'p-1' },
  { kind: 'task', id: 't-1' },
  { kind: 'document', id: 'd-1' },
  { kind: 'interaction', id: 'i-1' },
  { kind: 'asset', id: 'a-1' },
  { kind: 'ask' },
  { kind: 'ask', conversationId: 'c-1' },
  { kind: 'settings' },
  { kind: 'settings', section: 'keys' },
]

describe('route serialization', () => {
  it('round-trips every route kind through its path', () => {
    for (const route of ROUTES) {
      const parsed = routeFromPath(routeToPath(route))
      expect(routesEqual(parsed, route), `round-trip failed for ${routeToPath(route)}`).toBe(true)
    }
  })

  it('defaults unknown paths to Today', () => {
    expect(routeFromPath('/nonsense')).toEqual({ kind: 'today' })
    expect(routeFromPath('')).toEqual({ kind: 'today' })
  })

  it('encodes ids safely', () => {
    const path = routeToPath({ kind: 'person', id: 'a b/c' })
    expect(routeFromPath(path)).toEqual({ kind: 'person', id: 'a b/c' })
  })

  it('routesEqual distinguishes ids and tabs', () => {
    expect(routesEqual({ kind: 'task', id: 'a' }, { kind: 'task', id: 'b' })).toBe(false)
    expect(routesEqual({ kind: 'network', tab: 'people' }, { kind: 'network', tab: 'organizations' })).toBe(
      false,
    )
  })

  it('defaults Network to the graph tab', () => {
    expect(routeFromPath('/network')).toEqual({ kind: 'network', tab: 'graph' })
    expect(routeFromPath('/graph')).toEqual({ kind: 'network', tab: 'graph' })
  })

  it('maps detail routes to their sidebar section', () => {
    expect(sectionForRoute({ kind: 'task', id: 't' })).toBe('tasks')
    expect(sectionForRoute({ kind: 'person', id: 'p' })).toBe('network')
    expect(sectionForRoute({ kind: 'project', id: 'p' })).toBe('projects')
    expect(sectionForRoute({ kind: 'asset', id: 'a' })).toBe('today')
  })
})
