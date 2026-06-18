import type { ReactNode } from 'react'
import { DetailFields } from '../../components/detail-fields'
import { EmptyState } from '../../components/empty-state'
import { LinkedRecords } from '../../components/linked-records'
import { MemoryList } from '../../components/memory-list'
import { PageHead } from '../../components/page-head'
import { useMemoriesForRecord, usePerson, usePersonLinks } from '../../lib/queries'

export function PersonDetail({ id }: { id: string }): ReactNode {
  const person = usePerson(id)
  const links = usePersonLinks(id)
  const memories = useMemoriesForRecord('person', id)

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
      {links.data ? (
        <>
          <LinkedRecords title="Organizations" records={links.data.organizations} />
          <LinkedRecords title="Projects" records={links.data.projects} />
          <LinkedRecords title="Tasks" records={links.data.tasks} />
          <LinkedRecords title="Interactions" records={links.data.interactions} />
          <LinkedRecords title="Documents" records={links.data.documents} />
        </>
      ) : null}
      {memories.data ? <MemoryList records={memories.data} /> : null}
    </div>
  )
}
