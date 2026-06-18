// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { LinkedRecord } from '@local-brain/core'
import { screen } from '@testing-library/react'
import { LinkedRecords } from './linked-records'
import { renderWithProviders } from '../test/utils'

describe('LinkedRecords', () => {
  it('renders nothing when there are no records', () => {
    const { container } = renderWithProviders(<LinkedRecords title="Projects" records={[]} />)
    expect(container.textContent).toBe('')
  })

  it('renders navigable rows and trims ISO timestamps in subtitles', () => {
    const records: LinkedRecord[] = [
      { kind: 'person', id: 'p1', title: 'Alex Rivera', subtitle: 'Founder' },
      { kind: 'interaction', id: 'i1', title: 'Kickoff', subtitle: '2026-06-10T17:00:00.000Z' },
    ]
    renderWithProviders(<LinkedRecords title="Linked" records={records} />)

    expect(screen.getByText('Alex Rivera')).toBeDefined()
    // The ISO timestamp is shown as a calm date, not the raw string.
    expect(screen.getByText('2026-06-10')).toBeDefined()
    expect(screen.getByRole('button', { name: /Alex Rivera/ }).hasAttribute('disabled')).toBe(false)
  })

  it('disables records that have no detail route (memories)', () => {
    const records: LinkedRecord[] = [
      { kind: 'memory', id: 'm1', title: 'Alex founded Northwind', subtitle: null },
    ]
    renderWithProviders(<LinkedRecords title="Memories" records={records} />)
    const button = screen.getByRole('button', { name: /Alex founded Northwind/ })
    expect(button.hasAttribute('disabled')).toBe(true)
  })
})
