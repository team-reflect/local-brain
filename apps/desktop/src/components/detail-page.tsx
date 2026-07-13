import type { ReactNode } from 'react'
import { EmptyState } from './empty-state'
import { Loading } from './loading'
import { QueryError } from './query-error'

/** The shape every detail-page query hook satisfies (a TanStack query result). */
interface DetailQuery<T> {
  isLoading: boolean
  isError?: boolean
  error?: unknown
  refetch?: () => unknown
  data: T | null | undefined
}

/**
 * The shared scaffold for the six record detail pages: it owns the loading line,
 * the not-found empty state, and the centered column container, so each page only
 * describes its own header, fields, and linked sections. `children` receives the
 * loaded record, narrowed non-null.
 */
export function DetailPage<T>({
  query,
  notFoundTitle,
  errorTitle = 'Could not load this record',
  children,
}: {
  query: DetailQuery<T>
  notFoundTitle: string
  errorTitle?: string
  children: (data: T) => ReactNode
}): ReactNode {
  if (query.isLoading && query.data == null) return <Loading />
  if (query.isError && query.data == null) {
    return (
      <QueryError
        title={errorTitle}
        error={query.error}
        {...(query.refetch ? { onRetry: query.refetch } : {})}
      />
    )
  }
  if (query.data == null) return <EmptyState title={notFoundTitle} />
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      {query.isError ? (
        <QueryError
          title={errorTitle}
          error={query.error}
          {...(query.refetch ? { onRetry: query.refetch } : {})}
        />
      ) : null}
      {children(query.data)}
    </div>
  )
}
