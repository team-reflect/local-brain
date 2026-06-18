import type { ReactNode } from 'react'
import type { Citation } from '@local-brain/core'
import type { Route } from '../routing/route'
import { useRouter } from '../routing/router'
import { Section } from './section'

function sourceRoute(sourceType: string, sourceId: string): Route | null {
  if (sourceType === 'document') return { kind: 'document', id: sourceId }
  if (sourceType === 'interaction') return { kind: 'interaction', id: sourceId }
  return null
}

/**
 * A citation list: the evidence (quoted chunks of documents/interactions) that
 * grounds a fact or an automation's claim. Each entry quotes the source and
 * links back to it, so a user can inspect exactly what was cited.
 */
export function CitationList({
  title = 'Citations',
  citations,
  onRemove,
}: {
  title?: string
  citations: Citation[]
  /** When supplied, each citation gains a control to remove a wrong evidence ref. */
  onRemove?: ((citation: Citation) => void) | undefined
}): ReactNode {
  const { navigate } = useRouter()
  if (citations.length === 0) return null

  return (
    <Section title={title}>
      <ul className="flex flex-col gap-2">
        {citations.map((citation) => {
          const route = sourceRoute(citation.sourceType, citation.sourceId)
          return (
            <li
              key={citation.id}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <p className="border-l-2 border-border pl-2.5 italic text-foreground">
                “{citation.quote}”
              </p>
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={route === null}
                  onClick={route ? () => navigate(route) : undefined}
                  className="font-mono text-[11px] text-muted-foreground enabled:hover:text-foreground disabled:cursor-default"
                >
                  {citation.sourceTitle ?? citation.sourceType}
                </button>
                <div className="flex items-center gap-2">
                  {citation.note ? (
                    <span className="text-[11px] text-muted-foreground">{citation.note}</span>
                  ) : null}
                  {onRemove ? (
                    <button
                      type="button"
                      aria-label="Remove citation"
                      title="Remove citation"
                      onClick={() => onRemove(citation)}
                      className="text-[11px] text-muted-foreground hover:text-destructive"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}
