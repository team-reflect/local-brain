// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ChatMarkdown } from './chat-markdown'
import { chatSourcesFromMessageParts } from './chat-sources'

function groundingSources() {
  return chatSourcesFromMessageParts([
    {
      type: 'tool-search_records',
      state: 'output-available',
      output: {
        records: [
          {
            recordType: 'document',
            recordId: 'doc-1',
            recordRef: 'document:doc-1',
            title: 'Atlas plan',
            date: '2026-06-18T00:00:00.000Z',
            evidence: [{ chunkId: 'chunk-1', chunkIndex: 0 }],
          },
        ],
      },
    },
  ])
}

describe('ChatMarkdown citations', () => {
  it('renders a tool-validated record/chunk citation as a clickable source', () => {
    const onOpenSource = vi.fn()
    render(
      <ChatMarkdown
        text="The deadline is Friday [[record:document:doc-1#chunk-1]]."
        sources={groundingSources()}
        onOpenSource={onOpenSource}
      />,
    )

    const citation = screen.getByRole('button', { name: 'Atlas plan' })
    fireEvent.click(citation)
    expect(onOpenSource).toHaveBeenCalledWith(
      expect.objectContaining({ recordRef: 'document:doc-1' }),
    )
  })

  it('leaves unseen records and unseen chunks inert', () => {
    render(
      <ChatMarkdown
        text={
          'Unsupported [[record:document:missing#chunk-x]] and ' +
          '[[record:document:doc-1#made-up-chunk]].'
        }
        sources={groundingSources()}
        onOpenSource={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText(/\[\[record:document:missing#chunk-x\]\]/)).not.toBeNull()
    expect(screen.getByText(/\[\[record:document:doc-1#made-up-chunk\]\]/)).not.toBeNull()
  })
})
