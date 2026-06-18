import type { ReactNode } from 'react'
import { DetailFields } from '../../components/detail-fields'
import { EmptyState } from '../../components/empty-state'
import { LinkedRecords } from '../../components/linked-records'
import { PageHead } from '../../components/page-head'
import { Section } from '../../components/section'
import { useInteraction, useInteractionLinks, useInteractionParticipants } from '../../lib/queries'
import { useRouter } from '../../routing/router'

export function InteractionDetail({ id }: { id: string }): ReactNode {
  const { navigate } = useRouter()
  const interaction = useInteraction(id)
  const participants = useInteractionParticipants(id)
  const links = useInteractionLinks(id)

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
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() => navigate({ kind: 'person', id: person.id })}
                  className="rounded px-2 py-1 text-sm text-foreground hover:bg-secondary/60"
                >
                  {person.fullName}
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
          <LinkedRecords title="Projects" records={links.data.projects} />
          <LinkedRecords title="Organizations" records={links.data.organizations} />
          <LinkedRecords title="Documents" records={links.data.documents} />
          <LinkedRecords title="Tasks" records={links.data.tasks} />
        </>
      ) : null}
    </div>
  )
}
