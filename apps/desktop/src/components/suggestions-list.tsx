import type { ReactNode } from 'react'
import type { CurationSuggestion } from '@local-brain/core'
import { useAcceptSuggestion, useDismissSuggestion, useOpenSuggestions } from '../lib/queries'
import type { Route } from '../routing/route'
import { useRouter } from '../routing/router'
import { Badge } from './badge'
import { Button } from './button'
import { Section } from './section'

const KIND_LABEL: Record<string, string> = {
  create_project: 'Project',
  create_organization: 'Organization',
}

/** Record kinds a cited evidence link can navigate to. */
const NAVIGABLE: ReadonlySet<string> = new Set([
  'person',
  'organization',
  'project',
  'task',
  'document',
  'interaction',
])

export interface SuggestionsViewProps {
  suggestions: CurationSuggestion[]
  onAccept: (id: string) => void
  onDismiss: (id: string) => void
  onOpenRecord: (recordType: string, recordId: string) => void
  pending?: boolean
  errorMessage?: string | null
}

/**
 * Presentational suggestions queue: one card per open proposal with its kind,
 * title, rationale, cited evidence (clickable), and Accept/Dismiss. Renders
 * nothing when empty — a perpetually-empty section would be daily noise.
 */
export function SuggestionsView({
  suggestions,
  onAccept,
  onDismiss,
  onOpenRecord,
  pending = false,
  errorMessage = null,
}: SuggestionsViewProps): ReactNode {
  if (suggestions.length === 0) return null
  return (
    <Section title="Suggestions">
      <ul className="flex flex-col gap-2">
        {suggestions.map((suggestion) => (
          <li key={suggestion.id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge tone="accent">{KIND_LABEL[suggestion.kind] ?? suggestion.kind}</Badge>
                  <span className="truncate text-sm font-medium text-foreground">
                    {suggestion.title}
                  </span>
                </div>
                {suggestion.rationale ? (
                  <p className="mt-1 text-xs text-muted-foreground">{suggestion.rationale}</p>
                ) : null}
                {suggestion.links.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {suggestion.links.map((link) => (
                      <button
                        key={`${link.recordType}:${link.recordId}`}
                        type="button"
                        disabled={!NAVIGABLE.has(link.recordType)}
                        onClick={() => onOpenRecord(link.recordType, link.recordId)}
                        className="rounded bg-secondary/60 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:pointer-events-none"
                      >
                        {link.title}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pending}
                  onClick={() => onAccept(suggestion.id)}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => onDismiss(suggestion.id)}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {errorMessage ? <p className="mt-1 text-[11px] text-destructive">{errorMessage}</p> : null}
    </Section>
  )
}

/** Today's Suggestions section: wires the queue's read + accept/dismiss mutations. */
export function SuggestionsList(): ReactNode {
  const suggestions = useOpenSuggestions()
  const accept = useAcceptSuggestion()
  const dismiss = useDismissSuggestion()
  const { navigate } = useRouter()

  if (!suggestions.data) return null

  const error = (accept.error ?? dismiss.error) as Error | null
  return (
    <SuggestionsView
      suggestions={suggestions.data}
      onAccept={(id) => accept.mutate(id)}
      onDismiss={(id) => dismiss.mutate(id)}
      onOpenRecord={(recordType, recordId) => {
        if (NAVIGABLE.has(recordType)) navigate({ kind: recordType, id: recordId } as Route)
      }}
      pending={accept.isPending || dismiss.isPending}
      errorMessage={error?.message ?? null}
    />
  )
}
