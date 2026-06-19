// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatToolChip, isToolPartPending, toolNameFromPart, type ToolPart } from './chat-tool-chip'

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
