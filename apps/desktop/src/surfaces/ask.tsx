import type { ReactNode } from 'react'
import { EmptyState } from '../components/empty-state'
import { PageHead } from '../components/page-head'

/** Placeholder. The cited-answer chat shell is wired to retrieval in Plan 06. */
export function AskSurface(): ReactNode {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHead eyebrow="Ask" title="Ask" />
      <EmptyState
        title="Ask connects to retrieval in Plan 06"
        hint="A conversation list, chat panel, and citations over your local brain."
      />
    </div>
  )
}
