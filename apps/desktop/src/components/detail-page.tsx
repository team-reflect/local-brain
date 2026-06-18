import type { ReactNode } from 'react'
import { EmptyState } from './empty-state'
import { Loading } from './loading'

/** The shape every detail-page query hook satisfies (a TanStack query result). */
interface DetailQuery<T> {
  isLoading: boolean
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
  children,
}: {
  query: DetailQuery<T>
  notFoundTitle: string
  children: (data: T) => ReactNode
}): ReactNode {
  if (query.isLoading) return <Loading />
  if (!query.data) return <EmptyState title={notFoundTitle} />
  return <div className="mx-auto flex max-w-2xl flex-col gap-5">{children(query.data)}</div>
}
