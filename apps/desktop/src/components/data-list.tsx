import type { ReactNode } from 'react'
import { sectionLabel } from '../lib/ui'
import { cn } from '../lib/utils'
import { EmptyState } from './empty-state'
import { Loading } from './loading'

export interface Column<T> {
  key: string
  header: string
  className?: string
  render: (row: T) => ReactNode
}

interface DataListProps<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  empty?: ReactNode
  isLoading?: boolean
}

/** A dense, calm table for list surfaces (Reflect design system). */
export function DataList<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  empty,
  isLoading,
}: DataListProps<T>): ReactNode {
  if (isLoading) {
    return <Loading className="px-1 py-6" />
  }
  if (rows.length === 0) {
    return empty ?? <EmptyState title="Nothing here yet" />
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/40 text-left">
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn('px-3 py-2', sectionLabel, column.className)}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'border-b border-border/60 last:border-b-0',
                onRowClick ? 'cursor-pointer transition-colors hover:bg-secondary/50' : undefined,
              )}
            >
              {columns.map((column) => (
                <td key={column.key} className={cn('px-3 py-2 align-middle', column.className)}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
