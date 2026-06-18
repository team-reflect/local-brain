import type { ReactNode } from 'react'
import { DetailFields } from '../../components/detail-fields'
import { EmptyState } from '../../components/empty-state'
import { PageHead } from '../../components/page-head'
import { usePerson } from '../../lib/queries'

export function PersonDetail({ id }: { id: string }): ReactNode {
  const person = usePerson(id)

  if (person.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!person.data) return <EmptyState title="Person not found" />

  const p = person.data
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <PageHead eyebrow={p.isSelf ? 'You' : 'Person'} title={p.fullName} />
      <DetailFields
        fields={[
          { label: 'Headline', value: p.headline ?? '—' },
          { label: 'Email', value: p.primaryEmail ?? '—' },
          { label: 'Phone', value: p.primaryPhone ?? '—' },
          { label: 'Location', value: p.location ?? '—' },
          { label: 'Strength', value: p.relationshipStrength ?? '—' },
          { label: 'Last seen', value: p.lastInteractionAt?.slice(0, 10) ?? '—' },
        ]}
      />
      {p.summary ? <p className="text-sm text-foreground">{p.summary}</p> : null}
    </div>
  )
}
