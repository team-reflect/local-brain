import type { ReactNode } from 'react'
import type { Citation } from '@local-brain/core'
import { CitationList } from '../../components/citation-list'
import { DetailFields } from '../../components/detail-fields'
import { DetailPage } from '../../components/detail-page'
import { LinkedRecords } from '../../components/linked-records'
import { MemoryList } from '../../components/memory-list'
import { PageHead } from '../../components/page-head'
import { RecordInspectionPanel } from '../../components/record-inspection'
import { Section } from '../../components/section'
import {
  useDocument,
  useDocumentLinks,
  useEvidenceFromDocument,
  useMemoriesForRecord,
  useRecordInspection,
  useRemoveEvidenceRef,
  useUnlinkFrom,
} from '../../lib/queries'

export function DocumentDetail({ id }: { id: string }): ReactNode {
  const document = useDocument(id)
  const links = useDocumentLinks(id)
  const evidence = useEvidenceFromDocument(id)
  const memories = useMemoriesForRecord('document', id)
  const inspection = useRecordInspection('document', id)
  const onUnlink = useUnlinkFrom({ kind: 'document', id })
  const removeEvidence = useRemoveEvidenceRef()

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
    <DetailPage query={document} notFoundTitle="Document not found">
      {(d) => (
        <>
          <PageHead eyebrow="Document" title={d.title ?? 'Untitled document'} />
          <DetailFields
            fields={[
              { label: 'Kind', value: d.kind ?? '—' },
              { label: 'MIME type', value: d.mimeType ?? '—' },
              { label: 'Authored', value: d.authoredAt?.slice(0, 10) ?? '—' },
              { label: 'Occurred', value: d.occurredAt?.slice(0, 10) ?? '—' },
              { label: 'Source', value: d.originalUrl ?? d.originalPath ?? '—' },
              { label: 'Content hash', value: d.contentHash ?? '—' },
              { label: 'Created', value: d.createdAt.slice(0, 10) },
              { label: 'Updated', value: d.updatedAt.slice(0, 10) },
              { label: 'Archived', value: d.archivedAt?.slice(0, 10) ?? '—' },
            ]}
          />
          {d.summary ? <p className="text-sm text-foreground">{d.summary}</p> : null}
          {d.bodyText ? (
            <Section title="Body">
              <p className="whitespace-pre-wrap text-sm text-foreground">{d.bodyText}</p>
            </Section>
          ) : null}
          {links.data ? (
            <>
              <LinkedRecords title="People" records={links.data.people} onUnlink={onUnlink} />
              <LinkedRecords title="Organizations" records={links.data.organizations} onUnlink={onUnlink} />
              <LinkedRecords title="Projects" records={links.data.projects} onUnlink={onUnlink} />
              <LinkedRecords title="Interactions" records={links.data.interactions} onUnlink={onUnlink} />
              <LinkedRecords title="Tasks" records={links.data.tasks} onUnlink={onUnlink} />
              <LinkedRecords title="Assets" records={links.data.assets} onUnlink={onUnlink} />
            </>
          ) : null}
          {memories.data ? (
            <MemoryList records={memories.data} recordType="document" recordId={id} />
          ) : null}
          <CitationList
            title="Cited as evidence for"
            citations={citedFor}
            onRemove={(citation) => removeEvidence.mutate(citation.id)}
          />
          <RecordInspectionPanel inspection={inspection.data} />
        </>
      )}
    </DetailPage>
  )
}
