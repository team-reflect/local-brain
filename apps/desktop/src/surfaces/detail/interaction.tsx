import type { ReactNode } from 'react'
import { DetailFields } from '../../components/detail-fields'
import { EmptyState } from '../../components/empty-state'
import { LinkedRecords } from '../../components/linked-records'
import { PageHead } from '../../components/page-head'
import { Section } from '../../components/section'
import {
  useInteraction,
  useInteractionLinks,
  useInteractionParticipants,
  useUnlinkFrom,
} from '../../lib/queries'
import { useRouter } from '../../routing/router'

export function InteractionDetail({ id }: { id: string }): ReactNode {
  const { navigate } = useRouter()
  const interaction = useInteraction(id)
  const participants = useInteractionParticipants(id)
  const links = useInteractionLinks(id)
  const onUnlink = useUnlinkFrom({ kind: 'interaction', id })

  if (interaction.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!interaction.data) return <EmptyState title="Interaction not found" />

  const i = interaction.data
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <PageHead eyebrow={i.kind} title={i.title ?? 'Interaction'} />
      <DetailFields
        fields={[
          { label: 'Occurred', value: i.occurredAt?.slice(0, 16).replace('T', ' ') ?? '—' },
          { label: 'Location', value: i.location ?? '—' },
        ]}
      />
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
        </>
      ) : null}
    </div>
  )
}
