import type { ReactNode } from 'react'
import { DetailFields } from '../../components/detail-fields'
import { EmptyState } from '../../components/empty-state'
import { PageHead } from '../../components/page-head'
import { Section } from '../../components/section'
import { useDocument } from '../../lib/queries'

export function DocumentDetail({ id }: { id: string }): ReactNode {
  const document = useDocument(id)

  if (document.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!document.data) return <EmptyState title="Document not found" />

  const d = document.data
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <PageHead eyebrow="Document" title={d.title ?? 'Untitled document'} />
      <DetailFields
        fields={[
          { label: 'Kind', value: d.kind ?? '—' },
          { label: 'Authored', value: d.authoredAt?.slice(0, 10) ?? '—' },
          { label: 'Source', value: d.originalUrl ?? d.originalPath ?? '—' },
        ]}
      />
      {d.bodyText ? (
        <Section title="Body">
          <p className="whitespace-pre-wrap text-sm text-foreground">{d.bodyText}</p>
        </Section>
      ) : null}
    </div>
  )
}
