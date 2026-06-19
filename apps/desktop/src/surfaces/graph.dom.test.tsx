// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import type { Graph } from '@local-brain/core'
import { renderWithProviders } from '../test/utils'
import { GraphSurface } from './graph'

const GRAPH: Graph = {
  selfId: 'self',
  truncatedKinds: [],
  nodes: [
    { id: 'self', kind: 'self', label: 'You' },
    { id: 'p1', kind: 'person', label: 'Ada Lovelace' },
    { id: 'org1', kind: 'organization', label: 'Analytical Engines' },
  ],
  edges: [
    { source: 'self', target: 'p1', kind: 'knows' },
    { source: 'p1', target: 'org1', kind: 'affiliation' },
  ],
}

vi.mock('../lib/queries', () => ({
  useGraph: () => ({ data: GRAPH, isLoading: false }),
}))

describe('GraphSurface', () => {
  it('lets node types be toggled from the graph legend', () => {
    renderWithProviders(<GraphSurface showHeader={false} />)

    expect(screen.getByRole('group', { name: 'Graph node filters' })).toBeDefined()
    const people = screen.getByRole('checkbox', { name: 'People' }) as HTMLInputElement
    expect(people.checked).toBe(true)
    expect(screen.getByText('Ada Lovelace')).toBeDefined()
    expect(screen.getByText('Analytical Engines')).toBeDefined()

    fireEvent.click(people)

    expect(people.checked).toBe(false)
    expect(screen.queryByText('Ada Lovelace')).toBeNull()
    expect(screen.getByText('Analytical Engines')).toBeDefined()
  })
})
