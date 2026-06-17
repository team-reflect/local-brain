import type { ReactNode } from 'react'
import { EmptyState } from '../../components/empty-state'
import { PageHead } from '../../components/page-head'

/** Placeholder until organization getters land (alongside the Network org tab). */
export function OrganizationDetail({ id }: { id: string }): ReactNode {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <PageHead eyebrow="Organization" title="Organization" />
      <EmptyState title="Organization detail arrives with the org getters" hint={`id: ${id}`} />
    </div>
  )
}
