import type { ReactNode } from 'react'
import type { LinkedRecord } from '@local-brain/core'
import type { Route } from '../routing/route'
import { useRouter } from '../routing/router'
import { Section } from './section'

/** Map a linked record onto its typed detail route (memories have none). */
export function routeForLinkedRecord(record: LinkedRecord): Route | null {
  switch (record.kind) {
    case 'person':
      return { kind: 'person', id: record.id }
    case 'organization':
      return { kind: 'organization', id: record.id }
    case 'project':
      return { kind: 'project', id: record.id }
    case 'task':
      return { kind: 'task', id: record.id }
    case 'document':
      return { kind: 'document', id: record.id }
    case 'interaction':
      return { kind: 'interaction', id: record.id }
    case 'memory':
      return null
  }
}

/** Trim ISO timestamps used as subtitles down to a calm date. */
function hint(subtitle: string | null): string | null {
  if (!subtitle) return null
  return /^\d{4}-\d{2}-\d{2}T/.test(subtitle) ? subtitle.slice(0, 10) : subtitle
}

/**
 * A linked-record section: a titled list of navigable references to related
 * records. Renders nothing when empty so detail pages can list every relation
 * without leaving blank sections behind.
 */
export function LinkedRecords({
  title,
  records,
}: {
  title: string
  records: LinkedRecord[]
}): ReactNode {
  const { navigate } = useRouter()
  if (records.length === 0) return null

  return (
    <Section title={title}>
      <ul className="flex flex-col gap-0.5">
        {records.map((record) => {
          const route = routeForLinkedRecord(record)
          const subtitle = hint(record.subtitle)
          return (
            <li key={`${record.kind}:${record.id}`}>
              <button
                type="button"
                disabled={route === null}
                onClick={route ? () => navigate(route) : undefined}
                className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm enabled:hover:bg-secondary/60 disabled:cursor-default"
              >
                <span className="truncate text-foreground">{record.title}</span>
                {subtitle ? (
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {subtitle}
                  </span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}
