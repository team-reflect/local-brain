import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { sectionLabel } from '../lib/ui'
import { cn } from '../lib/utils'
import { EmptyState } from './empty-state'
import { Loading } from './loading'

export interface Column<T> {
  key: string
  header: string
  className?: string
  width?: string
  render: (row: T) => ReactNode
}

interface DataListProps<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  empty?: ReactNode
  isLoading?: boolean
  virtualize?: boolean
  estimateRowHeight?: number
  className?: string
  bodyClassName?: string
}

/** A dense, calm table for list surfaces (Reflect design system). */
export function DataList<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  empty,
  isLoading,
  virtualize = false,
  estimateRowHeight = 40,
  className,
  bodyClassName,
}: DataListProps<T>): ReactNode {
  if (isLoading) {
    return <Loading className="px-1 py-6" />
  }
  if (rows.length === 0) {
    return empty ?? <EmptyState title="Nothing here yet" />
  }

  if (virtualize) {
    return (
      <VirtualDataList
        rows={rows}
        columns={columns}
        rowKey={rowKey}
        onRowClick={onRowClick}
        estimateRowHeight={estimateRowHeight}
        className={className}
        bodyClassName={bodyClassName}
      />
    )
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border', className)}>
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
        <table className="w-full border-collapse text-sm">
          <thead>
          <tr className="border-b border-border bg-secondary/40 text-left">
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn('sticky top-0 z-10 bg-secondary/40 px-3 py-2', sectionLabel, column.className)}
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
    </div>
  )
}

interface VirtualDataListProps<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  onRowClick: ((row: T) => void) | undefined
  estimateRowHeight: number
  className: string | undefined
  bodyClassName: string | undefined
}

function VirtualDataList<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  estimateRowHeight,
  className,
  bodyClassName,
}: VirtualDataListProps<T>): ReactNode {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => estimateRowHeight,
    overscan: 12,
  })
  const gridTemplateColumns = columns.map((column) => column.width ?? 'minmax(0, 1fr)').join(' ')

  return (
    <div
      role="table"
      className={cn('flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border text-sm', className)}
    >
      <div role="rowgroup">
        <div
          role="row"
          className="grid border-b border-border bg-secondary/40 text-left"
          style={{ gridTemplateColumns }}
        >
          {columns.map((column) => (
            <div
              key={column.key}
              role="columnheader"
              className={cn('px-3 py-2', sectionLabel, column.className)}
            >
              {column.header}
            </div>
          ))}
        </div>
      </div>
      <div
        ref={setScrollElement}
        className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain', bodyClassName)}
      >
        <div role="rowgroup" className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]
            if (row === undefined) {
              return null
            }
            const key = rowKey(row)
            const handleRowClick = onRowClick
            const clickable = handleRowClick !== undefined
            return (
              <div
                key={key}
                ref={virtualizer.measureElement}
                role="row"
                data-index={item.index}
                tabIndex={clickable ? 0 : undefined}
                onClick={clickable ? () => handleRowClick(row) : undefined}
                onKeyDown={
                  clickable
                    ? (event: KeyboardEvent<HTMLDivElement>) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        handleRowClick(row)
                      }
                    : undefined
                }
                className={cn(
                  'absolute inset-x-0 grid border-b border-border/60 bg-background',
                  clickable ? 'cursor-pointer transition-colors hover:bg-secondary/50' : undefined,
                )}
                style={{
                  gridTemplateColumns,
                  transform: `translateY(${item.start}px)`,
                }}
              >
                {columns.map((column) => (
                  <div
                    key={column.key}
                    role="cell"
                    className={cn('min-w-0 px-3 py-2 align-middle', column.className)}
                  >
                    {column.render(row)}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
