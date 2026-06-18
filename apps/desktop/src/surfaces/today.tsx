import type { ReactNode } from 'react'
import { PageHead } from '../components/page-head'
import { Section } from '../components/section'
import { EmptyState } from '../components/empty-state'
import { useRouter } from '../routing/router'
import {
  useInteractions,
  useProjects,
  useReconnectSuggestions,
  useSelf,
  useTasks,
} from '../lib/queries'

/** The Today brief: a generated-operating-brief shell over real queries. */
export function TodaySurface(): ReactNode {
  const { navigate } = useRouter()
  const self = useSelf()
  const openTasks = useTasks({ status: 'open', limit: 6 })
  const interactions = useInteractions(5)
  const projects = useProjects()
  const reconnects = useReconnectSuggestions(5)

  const name = self.data?.preferredName ?? self.data?.fullName ?? 'there'

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-7">
      <PageHead eyebrow={todayLabel()} title={`Good to see you, ${name}`} />

      <div className="rounded-lg border border-border bg-card px-4 py-3.5">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground">Daily brief</p>
        <p className="mt-1.5 text-sm text-foreground">
          Your AI daily brief lands here once retrieval is wired up (Plan 06). For now,
          Today reads your open tasks, recent interactions, and active projects straight
          from the local brain.
        </p>
      </div>

      <Section title="Open tasks">
        {openTasks.data && openTasks.data.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {openTasks.data.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => navigate({ kind: 'task', id: task.id })}
                  className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-secondary/60"
                >
                  <span className="text-foreground">{task.title}</span>
                  {task.dueAt ? (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {task.dueAt.slice(0, 10)}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No open tasks" hint="Enjoy the calm." />
        )}
      </Section>

      {reconnects.data && reconnects.data.length > 0 ? (
        <Section title="Reconnect">
          <ul className="flex flex-col gap-1">
            {reconnects.data.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() => navigate({ kind: 'person', id: person.id })}
                  className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-secondary/60"
                >
                  <span className="text-foreground">{person.fullName}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {person.lastInteractionAt
                      ? `last seen ${person.lastInteractionAt.slice(0, 10)}`
                      : 'never connected'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Recent interactions">
        {interactions.data && interactions.data.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {interactions.data.map((interaction) => (
              <li key={interaction.id}>
                <button
                  type="button"
                  onClick={() => navigate({ kind: 'interaction', id: interaction.id })}
                  className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-secondary/60"
                >
                  <span className="text-foreground">{interaction.title ?? interaction.kind}</span>
                  {interaction.occurredAt ? (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {interaction.occurredAt.slice(0, 10)}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No interactions yet" />
        )}
      </Section>

      <Section title="Active projects">
        {projects.data && projects.data.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {projects.data.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  onClick={() => navigate({ kind: 'project', id: project.id })}
                  className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-secondary/60"
                >
                  <span className="text-foreground">{project.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {project.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No active projects" />
        )}
      </Section>
    </div>
  )
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}
