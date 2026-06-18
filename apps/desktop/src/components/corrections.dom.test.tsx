// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { Citation, LinkedRecord } from '@local-brain/core'
import { fireEvent, screen } from '@testing-library/react'
import { CitationList } from './citation-list'
import { LinkedRecords } from './linked-records'
import { renderWithProviders } from '../test/utils'

describe('correction affordances (Plan 05b)', () => {
  it('LinkedRecords shows an Unlink control only when onUnlink is given', () => {
    const records: LinkedRecord[] = [{ kind: 'project', id: 'pr1', title: 'Apollo', subtitle: null }]

    const { unmount } = renderWithProviders(<LinkedRecords title="Projects" records={records} />)
    expect(screen.queryByRole('button', { name: /Unlink Apollo/ })).toBeNull()
    unmount()

    const onUnlink = vi.fn()
    renderWithProviders(<LinkedRecords title="Projects" records={records} onUnlink={onUnlink} />)
    const unlink = screen.getByRole('button', { name: /Unlink Apollo/ })
    fireEvent.click(unlink)
    expect(onUnlink).toHaveBeenCalledWith(records[0])
  })

  it('CitationList shows a Remove control that reports the citation', () => {
    const citations: Citation[] = [
      {
        id: 'e1',
        note: null,
        quote: 'Alex owns the proposal.',
        sourceType: 'interaction',
        sourceId: 'i1',
        sourceTitle: 'Kickoff',
      },
    ]
    const onRemove = vi.fn()
    renderWithProviders(<CitationList citations={citations} onRemove={onRemove} />)
    fireEvent.click(screen.getByRole('button', { name: /Remove citation/ }))
    expect(onRemove).toHaveBeenCalledWith(citations[0])
  })
})
