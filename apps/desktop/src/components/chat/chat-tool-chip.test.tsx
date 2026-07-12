// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  ChatToolChip,
  isToolPartAwaitingApproval,
  isToolPartPending,
  toolNameFromPart,
  type ToolPart,
} from './chat-tool-chip'

function renderChip(part: ToolPart): void {
  render(<ChatToolChip part={part} />)
}

describe('toolNameFromPart', () => {
  it('strips the tool- prefix', () => {
    expect(toolNameFromPart({ type: 'tool-search_records' })).toBe('search_records')
    expect(toolNameFromPart({ type: 'tool-list_projects' })).toBe('list_projects')
  })

  it('returns the type unchanged when no prefix', () => {
    expect(toolNameFromPart({ type: 'search_records' })).toBe('search_records')
  })
})

describe('isToolPartPending', () => {
  it('is pending for input-streaming state', () => {
    expect(isToolPartPending({ type: 'tool-x', state: 'input-streaming' })).toBe(true)
  })

  it('is pending for input-available state', () => {
    expect(isToolPartPending({ type: 'tool-x', state: 'input-available' })).toBe(true)
  })

  it('is not pending for output-available state', () => {
    expect(isToolPartPending({ type: 'tool-x', state: 'output-available' })).toBe(false)
  })

  it('is not pending for output-error state', () => {
    expect(isToolPartPending({ type: 'tool-x', state: 'output-error' })).toBe(false)
  })
})

describe('isToolPartAwaitingApproval', () => {
  it('is awaiting approval only when approval-requested has an approval id', () => {
    expect(
      isToolPartAwaitingApproval({
        type: 'tool-create_task',
        state: 'approval-requested',
        approval: { id: 'approval-1' },
      }),
    ).toBe(true)
    expect(isToolPartAwaitingApproval({ type: 'tool-create_task', state: 'approval-requested' })).toBe(false)
    expect(
      isToolPartAwaitingApproval({
        type: 'tool-create_task',
        state: 'output-available',
        approval: { id: 'approval-1' },
      }),
    ).toBe(false)
  })
})

describe('ChatToolChip — search_records', () => {
  it('shows the query while pending', () => {
    renderChip({
      type: 'tool-search_records',
      toolCallId: 'tc-1',
      state: 'input-available',
      input: { query: 'Maya budget' },
    })
    expect(screen.getByText(/Searched "Maya budget"/)).not.toBeNull()
  })

  it('shows count when settled with results', () => {
    renderChip({
      type: 'tool-search_records',
      toolCallId: 'tc-1',
      state: 'output-available',
      input: { query: 'Atlas deadline' },
      output: { hits: [{}, {}], count: 2 },
    })
    expect(screen.getByText(/Searched "Atlas deadline"/)).not.toBeNull()
    expect(screen.getByText(/2 results/)).not.toBeNull()
  })

  it('shows singular "result" for count of 1', () => {
    renderChip({
      type: 'tool-search_records',
      toolCallId: 'tc-1',
      state: 'output-available',
      input: { query: 'q' },
      output: { hits: [{}], count: 1 },
    })
    expect(screen.getByText(/1 result\b/)).not.toBeNull()
  })

  it('shows zero results', () => {
    renderChip({
      type: 'tool-search_records',
      toolCallId: 'tc-1',
      state: 'output-available',
      input: { query: 'nothing' },
      output: { hits: [], count: 0 },
    })
    expect(screen.getByText(/0 results/)).not.toBeNull()
  })

  it('labels a query-less browse by its filters instead of an empty query', () => {
    renderChip({
      type: 'tool-search_records',
      toolCallId: 'tc-1',
      state: 'output-available',
      input: { recordTypes: ['interaction_transcript'], kinds: ['email'], sort: 'recency' },
      output: { hits: [{}, {}, {}], count: 3 },
    })
    // Kinds win over types for the label, and recency reads as "recent".
    expect(screen.getByText(/Browsed recent email/)).not.toBeNull()
    expect(screen.getByText(/3 results/)).not.toBeNull()
    expect(screen.queryByText(/Searched ""/)).toBeNull()
  })

  it('falls back to record-type labels when no kinds are given', () => {
    renderChip({
      type: 'tool-search_records',
      toolCallId: 'tc-1',
      state: 'output-available',
      input: { recordTypes: ['interaction_transcript'], after: '2026-06-07' },
      output: { hits: [{}], count: 1 },
    })
    expect(screen.getByText(/Browsed recent transcripts/)).not.toBeNull()
  })
})

describe('ChatToolChip — list_projects', () => {
  it('shows generic label while pending', () => {
    renderChip({
      type: 'tool-list_projects',
      toolCallId: 'tc-2',
      state: 'input-available',
      input: {},
    })
    expect(screen.getByText(/Listed projects/)).not.toBeNull()
  })

  it('shows status filter label when provided', () => {
    renderChip({
      type: 'tool-list_projects',
      toolCallId: 'tc-2',
      state: 'output-available',
      input: { status: 'paused' },
      output: { projects: [], count: 0 },
    })
    expect(screen.getByText(/Listed paused projects/)).not.toBeNull()
  })

  it('shows project count when settled', () => {
    renderChip({
      type: 'tool-list_projects',
      toolCallId: 'tc-2',
      state: 'output-available',
      input: {},
      output: { projects: [{}, {}, {}], count: 3 },
    })
    expect(screen.getByText(/3 projects/)).not.toBeNull()
  })

  it('shows singular "project" for count of 1', () => {
    renderChip({
      type: 'tool-list_projects',
      toolCallId: 'tc-2',
      state: 'output-available',
      input: {},
      output: { projects: [{}], count: 1 },
    })
    expect(screen.getByText(/1 project\b/)).not.toBeNull()
  })

  it('renders returned projects as sources', () => {
    const onOpenSource = vi.fn()
    render(
      <ChatToolChip
        part={{
          type: 'tool-list_projects',
          state: 'output-available',
          input: {},
          output: {
            records: [{
              recordType: 'project',
              recordId: 'p1',
              recordRef: 'project:p1',
              title: 'Atlas',
              date: '2026-07-12',
            }],
            count: 1,
          },
        }}
        onOpenSource={onOpenSource}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Atlas/ }))
    expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ recordRef: 'project:p1' }))
  })
})

describe('ChatToolChip — list_tasks', () => {
  it('shows filters, count, and returned task sources', () => {
    const onOpenSource = vi.fn()
    render(
      <ChatToolChip
        part={{
          type: 'tool-list_tasks',
          state: 'output-available',
          input: { statuses: ['open', 'waiting'] },
          output: {
            records: [{
              recordType: 'task',
              recordId: 't1',
              recordRef: 'task:t1',
              title: 'Send proposal',
              date: '2026-07-13',
            }],
            count: 1,
          },
        }}
        onOpenSource={onOpenSource}
      />,
    )

    expect(screen.getByText(/Listed open, waiting tasks/)).not.toBeNull()
    expect(screen.getByText(/1 task\b/)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Send proposal/ }))
    expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ recordRef: 'task:t1' }))
  })
})

describe('ChatToolChip — get_records', () => {
  it('shows generic label while pending', () => {
    renderChip({
      type: 'tool-get_records',
      toolCallId: 'tc-3',
      state: 'input-available',
      input: { records: [{ recordType: 'interaction', recordId: 'i1' }] },
    })
    expect(screen.getByText(/Loaded records/)).not.toBeNull()
  })

  it('shows record count when settled', () => {
    renderChip({
      type: 'tool-get_records',
      toolCallId: 'tc-3',
      state: 'output-available',
      input: { records: [{ recordType: 'interaction', recordId: 'i1' }] },
      output: { records: [{}, {}], count: 2 },
    })
    expect(screen.getByText(/Loaded records/)).not.toBeNull()
    expect(screen.getByText(/2 records/)).not.toBeNull()
  })

  it('renders returned record metadata as a compact clickable source', () => {
    const onOpenSource = vi.fn()
    const part: ToolPart = {
      type: 'tool-get_records',
      toolCallId: 'tc-3',
      state: 'output-available',
      input: { records: [{ recordType: 'interaction', recordId: 'i1' }] },
      output: {
        records: [
          {
            recordType: 'interaction',
            recordId: 'i1',
            recordRef: 'interaction:i1',
            title: 'Budget review',
            date: '2026-06-18T09:00:00.000Z',
            found: true,
            chunks: [{ chunkId: 'chunk-1', chunkIndex: 0 }],
          },
        ],
        count: 1,
      },
    }
    render(<ChatToolChip part={part} onOpenSource={onOpenSource} />)

    const source = screen.getByRole('button', { name: /Budget review/ })
    expect(screen.getByText(/Interaction · 2026-06-18/)).not.toBeNull()
    fireEvent.click(source)
    expect(onOpenSource).toHaveBeenCalledWith(
      expect.objectContaining({ recordRef: 'interaction:i1', title: 'Budget review' }),
    )
  })

  it('keeps missing and non-navigable returned records inert', () => {
    renderChip({
      type: 'tool-get_records',
      toolCallId: 'tc-3',
      state: 'output-available',
      input: { records: [] },
      output: {
        records: [
          { recordType: 'document', recordId: 'gone', title: 'Archived doc', found: false },
          { recordType: 'memory', recordId: 'm1', title: 'Private preference', found: true },
        ],
        count: 2,
      },
    })

    expect(screen.queryByRole('button', { name: /Archived doc/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Private preference/ })).toBeNull()
    expect(screen.getByText('Unavailable')).not.toBeNull()
  })
})

describe('ChatToolChip — write tools', () => {
  it('renders every normalized approval field with icon-only controls', () => {
    const onApprovalResponse = vi.fn()
    render(
      <ChatToolChip
        part={{
          type: 'tool-create_task',
          toolCallId: 'tc-4',
          state: 'approval-requested',
          input: { title: 'Send budget', status: 'open', dueAt: '2026-06-24' },
          approval: { id: 'approval-1' },
        }}
        onApprovalResponse={onApprovalResponse}
      />,
    )

    expect(screen.getByText('Create task')).not.toBeNull()
    expect(screen.getByText('Needs approval')).not.toBeNull()
    expect(screen.getByText('Send budget')).not.toBeNull()
    expect(screen.getByText('status')).not.toBeNull()
    expect(screen.getByText('open')).not.toBeNull()
    expect(screen.getByText('dueAt')).not.toBeNull()
    expect(screen.getByText('2026-06-24')).not.toBeNull()
    expect(screen.queryByText('Approve')).toBeNull()
    expect(screen.queryByText('Deny')).toBeNull()

    const buttons = screen.getAllByRole('button')
    expect(buttons[0]?.getAttribute('aria-label')).toBe('Deny create task')
    expect(buttons[1]?.getAttribute('aria-label')).toBe('Approve create task')

    fireEvent.click(screen.getByRole('button', { name: /Approve create task/ }))
    expect(onApprovalResponse).toHaveBeenCalledWith({ id: 'approval-1', approved: true })
    fireEvent.click(screen.getByRole('button', { name: /Deny create task/ }))
    expect(onApprovalResponse).toHaveBeenCalledWith({ id: 'approval-1', approved: false })
  })

  it('renders memory approvals with nested subject fields', () => {
    renderChip({
      type: 'tool-remember_fact',
      toolCallId: 'tc-7',
      state: 'approval-requested',
      input: {
        claim: 'Maya prefers async updates.',
        kind: 'preference',
        confidence: 0.8,
        subjects: [{ recordType: 'person', recordId: 'person-1', role: 'about' }],
      },
      approval: { id: 'approval-2' },
    })

    expect(screen.getByText('Remember fact')).not.toBeNull()
    expect(screen.getByText('Maya prefers async updates.')).not.toBeNull()
    expect(screen.getByText('subjects[0].recordType')).not.toBeNull()
    expect(screen.getByText('person-1')).not.toBeNull()
    expect(screen.getByText('subjects[0].role')).not.toBeNull()
    expect(screen.getByText('about')).not.toBeNull()
    expect(screen.getByText('kind')).not.toBeNull()
    expect(screen.getByText('preference')).not.toBeNull()
    expect(screen.getByText('confidence')).not.toBeNull()
    expect(screen.getByText('0.8')).not.toBeNull()
  })

  it('renders update approvals as a field diff including explicit clears', () => {
    renderChip({
      type: 'tool-update_task',
      toolCallId: 'tc-8',
      state: 'approval-requested',
      input: { id: 'task-1', status: 'done', projectId: null },
      approval: { id: 'approval-3' },
    })

    expect(screen.getByText('Update task')).not.toBeNull()
    expect(screen.getByText('task-1')).not.toBeNull()
    expect(screen.getByText('status')).not.toBeNull()
    expect(screen.getByText('done')).not.toBeNull()
    expect(screen.getByText('projectId')).not.toBeNull()
    expect(screen.getByText('Clear')).not.toBeNull()
  })

  it('does not hide sensitive or nested participant fields before approval', () => {
    renderChip({
      type: 'tool-log_interaction',
      toolCallId: 'tc-sensitive',
      state: 'approval-requested',
      input: {
        title: 'Private review',
        bodyText: 'Discuss compensation and health leave.',
        participants: [{
          personId: 'person-7',
          displayName: 'Maya Chen',
          handle: 'maya@example.com',
          role: 'attendee',
        }],
      },
      approval: { id: 'approval-sensitive' },
    })

    expect(screen.getByText('bodyText')).not.toBeNull()
    expect(screen.getByText('Discuss compensation and health leave.')).not.toBeNull()
    expect(screen.getByText('participants[0].personId')).not.toBeNull()
    expect(screen.getByText('participants[0].displayName')).not.toBeNull()
    expect(screen.getByText('participants[0].handle')).not.toBeNull()
    expect(screen.getByText('maya@example.com')).not.toBeNull()
    expect(screen.getByText('participants[0].role')).not.toBeNull()
  })

  it('keeps the approval row stable after approval', () => {
    renderChip({
      type: 'tool-create_task',
      toolCallId: 'tc-9',
      state: 'approval-responded',
      input: { title: 'Send budget' },
      approval: { id: 'approval-4', approved: true },
    })

    expect(screen.getByText('Create task')).not.toBeNull()
    expect(screen.getByText('Approved')).not.toBeNull()
    expect(screen.getByText('Send budget')).not.toBeNull()
    expect(screen.queryByText('Needs approval')).toBeNull()

    const buttons = screen.getAllByRole('button')
    expect(buttons[0]?.getAttribute('aria-label')).toBe('Deny create task')
    expect(buttons[0]).toHaveProperty('disabled', true)
    expect(buttons[1]?.getAttribute('aria-label')).toBe('Approved create task')
    expect(buttons[1]).toHaveProperty('disabled', true)
    expect(buttons[1]?.className).toContain('text-emerald-600')
  })

  it('keeps the approval row stable after denial', () => {
    renderChip({
      type: 'tool-create_task',
      toolCallId: 'tc-10',
      state: 'approval-responded',
      input: { title: 'Send budget' },
      approval: { id: 'approval-5', approved: false },
    })

    expect(screen.getByText('Create task')).not.toBeNull()
    expect(screen.getByText('Denied')).not.toBeNull()
    expect(screen.getByText('Send budget')).not.toBeNull()

    const buttons = screen.getAllByRole('button')
    expect(buttons[0]?.getAttribute('aria-label')).toBe('Denied create task')
    expect(buttons[0]).toHaveProperty('disabled', true)
    expect(buttons[1]?.getAttribute('aria-label')).toBe('Approve create task')
    expect(buttons[1]).toHaveProperty('disabled', true)
  })

  it('renders settled write output as an approved stable row', () => {
    renderChip({
      type: 'tool-remember_fact',
      toolCallId: 'tc-5',
      state: 'output-available',
      input: { claim: 'Alex prefers async updates.' },
      output: { kind: 'memory', action: 'existing', id: 'memory-1' },
    })

    expect(screen.getByText('Remember fact')).not.toBeNull()
    expect(screen.getByText('Approved')).not.toBeNull()
    expect(screen.getByText('Alex prefers async updates.')).not.toBeNull()
    expect(screen.queryByText(/memory-1/)).toBeNull()
  })

  it('renders denied write output as a stable row', () => {
    renderChip({
      type: 'tool-update_task',
      toolCallId: 'tc-6',
      state: 'output-denied',
      input: { id: 'task-1', status: 'done' },
    })

    expect(screen.getByText('Update task')).not.toBeNull()
    expect(screen.getByText('Denied')).not.toBeNull()
    expect(screen.getByText('task-1')).not.toBeNull()
  })
})

describe('ChatToolChip — unknown tool', () => {
  it('renders a generic chip for unknown tool names', () => {
    renderChip({
      type: 'tool-do_something',
      toolCallId: 'tc-3',
      state: 'output-available',
      input: {},
    })
    expect(screen.getByText('do something')).not.toBeNull()
  })
})
