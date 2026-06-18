import type { ReactNode } from 'react'
import type { Citation } from '@local-brain/core'
import { CitationList } from '../../components/citation-list'
import { DetailFields } from '../../components/detail-fields'
import { EmptyState } from '../../components/empty-state'
import { LinkedRecords } from '../../components/linked-records'
import { PageHead } from '../../components/page-head'
import { Section } from '../../components/section'
import { useDocument, useDocumentLinks, useEvidenceFromDocument } from '../../lib/queries'

export function DocumentDetail({ id }: { id: string }): ReactNode {
  const document = useDocument(id)
  const links = useDocumentLinks(id)
  const evidence = useEvidenceFromDocument(id)

  if (document.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!document.data) return <EmptyState title="Document not found" />

  const d = document.data
  // Reuse the citation list to show what this document has been cited as evidence for.
  const citedFor: Citation[] = (evidence.data ?? []).map((row) => ({
    id: row.id,
    note: row.note,
    quote: row.quote,
    sourceType: row.subjectType,
    sourceId: row.subjectId,
    sourceTitle: row.claim,
  }))

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
      {links.data ? (
        <>
          <LinkedRecords title="People" records={links.data.people} />
          <LinkedRecords title="Projects" records={links.data.projects} />
          <LinkedRecords title="Interactions" records={links.data.interactions} />
          <LinkedRecords title="Tasks" records={links.data.tasks} />
        </>
      ) : null}
      <CitationList title="Cited as evidence for" citations={citedFor} />
    </div>
  )
}
