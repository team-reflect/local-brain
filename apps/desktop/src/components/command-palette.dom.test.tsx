// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { CommandPalette } from './command-palette'
import { registerAppCommands } from '../lib/commands/app-commands'
import { resetCommands } from '../lib/commands/registry'
import type { CommandContext } from '../lib/commands/types'
import { installFakeBridge, renderWithProviders } from '../test/utils'

function context(): CommandContext {
  return { navigate: vi.fn(), back: vi.fn(), forward: vi.fn(), openPalette: vi.fn(), openAdd: vi.fn() }
}

describe('CommandPalette', () => {
  beforeEach(() => {
    resetCommands()
    registerAppCommands()
    installFakeBridge({ queryRows: [] })
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

  it('searches records and opens the selected one', async () => {
    const ctx = context()
    // Only the people query returns a row; other record queries stay empty.
    installFakeBridge({
      query: (sql) =>
        sql.includes('from "people"')
          ? [{ id: 'p1', title: 'Ada Lovelace', subtitle: 'Mathematician' }]
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
})
