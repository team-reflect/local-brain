import type { ReactNode } from 'react'
import { DetailFields } from '../../components/detail-fields'
import { DetailPage } from '../../components/detail-page'
import { LinkedRecords } from '../../components/linked-records'
import { MemoryList } from '../../components/memory-list'
import { PageHead } from '../../components/page-head'
import { RecordInspectionPanel } from '../../components/record-inspection'
import { Section } from '../../components/section'
import {
  useInteraction,
  useInteractionLinks,
  useInteractionParticipants,
  useMemoriesForRecord,
  useRecordInspection,
  useUnlinkFrom,
} from '../../lib/queries'
import { useRouter } from '../../routing/router'

export function InteractionDetail({ id }: { id: string }): ReactNode {
  const { navigate } = useRouter()
  const interaction = useInteraction(id)
  const participants = useInteractionParticipants(id)
  const links = useInteractionLinks(id)
  const memories = useMemoriesForRecord('interaction', id)
  const inspection = useRecordInspection('interaction', id)
  const onUnlink = useUnlinkFrom({ kind: 'interaction', id })

  return (
    <DetailPage query={interaction} notFoundTitle="Interaction not found">
      {(i) => (
        <>
          <PageHead eyebrow={i.kind} title={i.title ?? 'Interaction'} />
          <DetailFields
            fields={[
              { label: 'Occurred', value: i.occurredAt?.slice(0, 16).replace('T', ' ') ?? '—' },
              { label: 'Ended', value: i.endedAt?.slice(0, 16).replace('T', ' ') ?? '—' },
              { label: 'Duration', value: i.durationSeconds ?? '—' },
              { label: 'Location', value: i.location ?? '—' },
              { label: 'External id', value: i.externalId ?? '—' },
              { label: 'Source', value: i.originalUrl ?? i.originalPath ?? '—' },
              { label: 'Content hash', value: i.contentHash ?? '—' },
              { label: 'Metadata', value: i.metadataJson ?? '—' },
              { label: 'Created', value: i.createdAt.slice(0, 10) },
              { label: 'Updated', value: i.updatedAt.slice(0, 10) },
              { label: 'Archived', value: i.archivedAt?.slice(0, 10) ?? '—' },
            ]}
          />
          {i.summary ? <p className="text-sm text-foreground">{i.summary}</p> : null}
          <Section title="Participants">
            {participants.data && participants.data.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {participants.data.map((person) => (
                  <li key={person.id} className="group flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => navigate({ kind: 'person', id: person.id })}
                      className="flex-1 rounded px-2 py-1 text-left text-sm text-foreground hover:bg-secondary/60"
                    >
                      {person.fullName}
                    </button>
                    <button
                      type="button"
                      aria-label={`Unlink ${person.fullName}`}
                      title="Unlink"
                      onClick={() => onUnlink({ kind: 'person', id: person.id, title: person.fullName, subtitle: null })}
                      className="shrink-0 rounded-md px-2 py-1 text-[11px] text-muted-foreground opacity-0 hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                    >
                      Unlink
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No linked participants.</p>
            )}
          </Section>
          {i.bodyText ? (
            <Section title="Notes">
              <p className="whitespace-pre-wrap text-sm text-foreground">{i.bodyText}</p>
            </Section>
          ) : null}
          {links.data ? (
            <>
              <LinkedRecords title="Projects" records={links.data.projects} onUnlink={onUnlink} />
              <LinkedRecords title="Organizations" records={links.data.organizations} onUnlink={onUnlink} />
              <LinkedRecords title="Documents" records={links.data.documents} onUnlink={onUnlink} />
              <LinkedRecords title="Tasks" records={links.data.tasks} onUnlink={onUnlink} />
              <LinkedRecords title="Assets" records={links.data.assets} onUnlink={onUnlink} />
            </>
          ) : null}
          {memories.data ? (
            <MemoryList records={memories.data} recordType="interaction" recordId={id} />
          ) : null}
          <RecordInspectionPanel inspection={inspection.data} />
        </>
      )}
    </DetailPage>
  )
}
