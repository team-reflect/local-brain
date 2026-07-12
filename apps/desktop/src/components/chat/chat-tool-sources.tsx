import type { ReactNode } from 'react'
import {
  chatSourceDateLabel,
  chatSourcesFromToolPart,
  chatSourceTypeLabel,
  routeForChatSource,
  type ChatSource,
  type ChatSourceToolPart,
} from './chat-sources'

function SourceRow({
  source,
  onOpenSource,
}: {
  source: ChatSource
  onOpenSource?: (source: ChatSource) => void
}): ReactNode {
  const route = routeForChatSource(source)
  const title = source.title ?? source.recordRef
  const date = chatSourceDateLabel(source.date)
  const metadata = [chatSourceTypeLabel(source.recordType), date].filter(Boolean).join(' · ')
  const content = (
    <>
      <span className="min-w-0 flex-1 truncate text-foreground">{title}</span>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
        {source.available ? metadata : 'Unavailable'}
      </span>
    </>
  )

  return (
    <li className="min-w-0">
      {route && onOpenSource ? (
        <button
          type="button"
          className="flex w-full min-w-0 items-baseline gap-2 rounded-sm px-1.5 py-0.5 text-left hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onOpenSource(source)}
        >
          {content}
        </button>
      ) : (
        <span className="flex min-w-0 items-baseline gap-2 px-1.5 py-0.5">{content}</span>
      )}
    </li>
  )
}

/** Render compact source rows extracted from one settled Chat read-tool result. */
export function ChatToolSources({
  part,
  onOpenSource,
}: {
  part: ChatSourceToolPart
  onOpenSource?: (source: ChatSource) => void
}): ReactNode {
  const sources = chatSourcesFromToolPart(part)
  if (sources.length === 0) return null
  const visible = sources.slice(0, 4)
  const remaining = sources.slice(4)

  return (
    <div className="mt-1 ml-[18px] max-w-xl border-l border-primary/25 pl-1.5 text-xs">
      <ul className="min-w-0">
        {visible.map((source) => (
          <SourceRow
            key={source.recordRef}
            source={source}
            {...(onOpenSource ? { onOpenSource } : {})}
          />
        ))}
      </ul>
      {remaining.length > 0 ? (
        <details>
          <summary className="cursor-pointer px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">
            Show {remaining.length} more
          </summary>
          <ul className="min-w-0">
            {remaining.map((source) => (
              <SourceRow
                key={source.recordRef}
                source={source}
                {...(onOpenSource ? { onOpenSource } : {})}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
