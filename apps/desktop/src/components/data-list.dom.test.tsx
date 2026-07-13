// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DataList, type Column } from './data-list'

interface Row {
  id: string
  title: string
}

const columns: Column<Row>[] = [
  {
    key: 'title',
    header: 'Title',
    render: (row) => row.title,
  },
]

describe('DataList', () => {
  it.each(['Enter', ' '])('opens a non-virtual row with %j', (key) => {
    const onRowClick = vi.fn()
    const row = { id: 'one', title: 'First record' }
    render(
      <DataList
        rows={[row]}
        columns={columns}
        rowKey={(item) => item.id}
        onRowClick={onRowClick}
      />,
    )

    const dataRow = screen.getAllByRole('row')[1]
    expect(dataRow?.tabIndex).toBe(0)
    if (!dataRow) throw new Error('Expected a data row')

    fireEvent.keyDown(dataRow, { key })

    expect(onRowClick).toHaveBeenCalledWith(row)
  })

  it('does not activate a row when a nested control handles the key', () => {
    const onRowClick = vi.fn()
    const action = vi.fn()
    const actionColumns: Column<Row>[] = [
      ...columns,
      {
        key: 'action',
        header: 'Action',
        render: () => <button onClick={action}>Edit</button>,
      },
    ]
    render(
      <DataList
        rows={[{ id: 'one', title: 'First record' }]}
        columns={actionColumns}
        rowKey={(item) => item.id}
        onRowClick={onRowClick}
      />,
    )

    fireEvent.keyDown(screen.getByRole('button', { name: 'Edit' }), { key: 'Enter' })

    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('shows a retryable error instead of an empty state', () => {
    const onRetry = vi.fn()
    render(
      <DataList
        rows={[]}
        columns={columns}
        rowKey={(item) => item.id}
        error={new Error('Database unavailable')}
        errorTitle="Could not load projects"
        onRetry={onRetry}
        empty={<p>No projects yet</p>}
      />,
    )

    expect(screen.getByRole('alert').textContent).toContain('Could not load projects')
    expect(screen.getByRole('alert').textContent).toContain('Database unavailable')
    expect(screen.queryByText('No projects yet')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('keeps stale rows visible while reporting a refresh error', () => {
    render(
      <DataList
        rows={[{ id: 'one', title: 'Cached record' }]}
        columns={columns}
        rowKey={(item) => item.id}
        error={new Error('Refresh failed')}
      />,
    )

    expect(screen.getByRole('alert').textContent).toContain('Refresh failed')
    expect(screen.getByText('Cached record')).toBeDefined()
  })

  it('reports refresh errors in a virtualized list too', () => {
    render(
      <DataList
        rows={[{ id: 'one', title: 'Cached record' }]}
        columns={columns}
        rowKey={(item) => item.id}
        error={new Error('Virtual refresh failed')}
        virtualize
      />,
    )

    expect(screen.getByRole('alert').textContent).toContain('Virtual refresh failed')
  })
})
