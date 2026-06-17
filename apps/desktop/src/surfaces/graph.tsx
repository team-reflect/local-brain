import type { ReactNode } from 'react'
import { EmptyState } from '../components/empty-state'
import { PageHead } from '../components/page-head'

/** Placeholder. The user-centered node graph is built in 03b. */
export function GraphSurface(): ReactNode {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHead eyebrow="Graph" title="Graph" />
      <EmptyState
        title="The brain graph lands in 03b"
        hint="A user-centered node map over people, projects, tasks, documents, interactions, and memories."
      />
    </div>
  )
}
