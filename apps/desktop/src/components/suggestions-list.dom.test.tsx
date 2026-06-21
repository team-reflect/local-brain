// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { CurationSuggestion } from '@local-brain/core'
import { fireEvent, screen } from '@testing-library/react'
import { SuggestionsView } from './suggestions-list'
import { renderWithProviders } from '../test/utils'

const sample: CurationSuggestion[] = [
  {
    id: 's1',
    kind: 'create_project',
    title: 'South Africa Trip',
    rationale: 'multi-leg travel thread — project-shaped',
    status: 'open',
    payload: { name: 'South Africa Trip' },
    links: [{ recordType: 'interaction', recordId: 'i1', title: 'SA trip thread' }],
    createdAt: '2026-06-20T00:00:00.000Z',
  },
]

const noop = () => {}

describe('SuggestionsView', () => {
  it('renders nothing when there are no open suggestions', () => {
    renderWithProviders(
      <SuggestionsView suggestions={[]} onAccept={noop} onDismiss={noop} onOpenRecord={noop} />,
    )
    expect(screen.queryByText('Suggestions')).toBeNull()
  })

  it('renders a card with kind, title, rationale, and evidence', () => {
    renderWithProviders(
      <SuggestionsView suggestions={sample} onAccept={noop} onDismiss={noop} onOpenRecord={noop} />,
    )
    expect(screen.getByText('South Africa Trip')).toBeTruthy()
    expect(screen.getByText('Project')).toBeTruthy()
    expect(screen.getByText('multi-leg travel thread — project-shaped')).toBeTruthy()
    expect(screen.getByText('SA trip thread')).toBeTruthy()
  })

  it('fires accept, dismiss, and open-record callbacks', () => {
    const onAccept = vi.fn()
    const onDismiss = vi.fn()
    const onOpenRecord = vi.fn()
    renderWithProviders(
      <SuggestionsView
        suggestions={sample}
        onAccept={onAccept}
        onDismiss={onDismiss}
        onOpenRecord={onOpenRecord}
      />,
    )
    fireEvent.click(screen.getByText('SA trip thread'))
    expect(onOpenRecord).toHaveBeenCalledWith('interaction', 'i1')
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(onAccept).toHaveBeenCalledWith('s1')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledWith('s1')
  })

  it('shows an error message when provided', () => {
    renderWithProviders(
      <SuggestionsView
        suggestions={sample}
        onAccept={noop}
        onDismiss={noop}
        onOpenRecord={noop}
        errorMessage="This suggestion was resolved concurrently."
      />,
    )
    expect(screen.getByText(/resolved concurrently/)).toBeTruthy()
  })

  it('disables Accept/Dismiss while a mutation is pending', () => {
    renderWithProviders(
      <SuggestionsView
        suggestions={sample}
        onAccept={noop}
        onDismiss={noop}
        onOpenRecord={noop}
        pending
      />,
    )
    expect((screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
