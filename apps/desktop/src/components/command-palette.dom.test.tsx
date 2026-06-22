// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { CommandPalette } from './command-palette'
import { registerAppCommands } from '../lib/commands/app-commands'
import { resetCommands } from '../lib/commands/registry'
import type { CommandContext } from '../lib/commands/types'
import { installFakeBridge, renderWithProviders } from '../test/utils'

function context(): CommandContext {
  return { navigate: vi.fn(), back: vi.fn(), forward: vi.fn(), openPalette: vi.fn() }
}

describe('CommandPalette', () => {
  beforeEach(() => {
    resetCommands()
    registerAppCommands()
    installFakeBridge({ queryRows: [] })
    HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  it('filters commands by query and runs the selected one on Enter', () => {
    const ctx = context()
    renderWithProviders(<CommandPalette open onClose={() => {}} context={ctx} />)

    const input = screen.getByPlaceholderText(/Search records or run a command/)
    fireEvent.change(input, { target: { value: 'graph' } })

    expect(screen.getByText('Open Graph')).toBeDefined()
    expect(screen.queryByText('Go to Today')).toBeNull()

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(ctx.navigate).toHaveBeenCalledWith({ kind: 'network', tab: 'graph' })
  })

  it('moves the selection with the arrow keys', () => {
    const ctx = context()
    renderWithProviders(<CommandPalette open onClose={() => {}} context={ctx} />)
    const input = screen.getByPlaceholderText(/Search records or run a command/)

    // Empty query lists every command; ArrowDown moves off the first (Go to Today).
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(ctx.navigate).toHaveBeenCalledWith({ kind: 'tasks' })
  })

  it('closes on Escape via the dialog primitive', () => {
    const onClose = vi.fn()
    renderWithProviders(<CommandPalette open onClose={onClose} context={context()} />)

    const input = screen.getByPlaceholderText(/Search records or run a command/)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('renders nothing while closed', () => {
    renderWithProviders(<CommandPalette open={false} onClose={() => {}} context={context()} />)
    expect(screen.queryByPlaceholderText(/Search records or run a command/)).toBeNull()
  })

  it('searches records and opens the selected one', async () => {
    const ctx = context()
    installFakeBridge({
      query: (sql) =>
        sql.includes('FROM people') && sql.includes('full_name LIKE')
          ? [{ id: 'p1', title: 'Ada Lovelace', subtitle: 'Mathematician', recordDate: '2026-06-01T00:00:00.000Z' }]
          : [],
    })

    renderWithProviders(<CommandPalette open onClose={() => {}} context={ctx} />)
    const input = screen.getByPlaceholderText(/Search records or run a command/)
    fireEvent.change(input, { target: { value: 'Ada' } })

    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeDefined())
    expect(screen.getByText('Records')).toBeDefined()

    fireEvent.click(screen.getByText('Ada Lovelace'))
    expect(ctx.navigate).toHaveBeenCalledWith({ kind: 'person', id: 'p1' })
  })

  it('uses global search snippets and lists records before commands', async () => {
    installFakeBridge({
      query: (sql) =>
        sql.includes('documents_fts')
          ? [
              {
                id: 'd1',
                title: 'Chat research note',
                subtitle: 'note',
                snippet: '[Chat] research',
                recordDate: '2026-06-01T00:00:00.000Z',
                bm25: -8,
              },
            ]
          : [],
    })

    renderWithProviders(<CommandPalette open onClose={() => {}} context={context()} />)
    const input = screen.getByPlaceholderText(/Search records or run a command/)
    fireEvent.change(input, { target: { value: 'chat' } })

    await waitFor(() => expect(screen.getByText('Chat research note')).toBeDefined())
    expect(screen.getByText((_, element) => element?.textContent === 'Chat research')).toBeDefined()
    expect(screen.getByText('Go to Chat')).toBeDefined()

    const records = screen.getByText('Records')
    const commands = screen.getByText('Commands')
    expect(Boolean(records.compareDocumentPosition(commands) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
  })

  it('waits for global search before showing no matches', async () => {
    let resolveQuery: (rows: unknown[]) => void = () => {}
    const pendingQuery = new Promise<unknown[]>((resolve) => {
      resolveQuery = resolve
    })
    installFakeBridge({ query: () => pendingQuery })

    renderWithProviders(<CommandPalette open onClose={() => {}} context={context()} />)
    const input = screen.getByPlaceholderText(/Search records or run a command/)
    fireEvent.change(input, { target: { value: 'zzzznotfound' } })

    expect(screen.queryByText('No matches')).toBeNull()

    resolveQuery([])
    await waitFor(() => expect(screen.getByText('No matches')).toBeDefined())
  })

  it('does not steal a user-selected command when record results arrive', async () => {
    const ctx = context()
    let resolveDocuments: (rows: unknown[]) => void = () => {}
    const documentQuery = new Promise<unknown[]>((resolve) => {
      resolveDocuments = resolve
    })
    installFakeBridge({
      query: (sql) =>
        sql.includes('documents_fts')
          ? documentQuery
          : [],
    })

    renderWithProviders(<CommandPalette open onClose={() => {}} context={ctx} />)
    const input = screen.getByPlaceholderText(/Search records or run a command/)
    fireEvent.change(input, { target: { value: 'go' } })

    expect(screen.getByText('Go to Today')).toBeDefined()
    fireEvent.keyDown(input, { key: 'ArrowDown' })

    resolveDocuments([
      {
        id: 'd1',
        title: 'Go market notes',
        subtitle: 'note',
        snippet: '[Go] market',
        recordDate: '2026-06-01T00:00:00.000Z',
        bm25: -8,
      },
    ])
    await waitFor(() => expect(screen.getByText('Go market notes')).toBeDefined())

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(ctx.navigate).toHaveBeenCalledWith({ kind: 'tasks' })
  })

  it('keeps > as command-only mode', () => {
    const query = vi.fn(() => [])
    installFakeBridge({ query })

    renderWithProviders(<CommandPalette open onClose={() => {}} context={context()} />)
    const input = screen.getByPlaceholderText(/Search records or run a command/)
    fireEvent.change(input, { target: { value: '>graph' } })

    expect(screen.getByText('Open Graph')).toBeDefined()
    expect(screen.queryByText('Records')).toBeNull()
    expect(query).not.toHaveBeenCalled()
  })
})
