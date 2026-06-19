import type { ReactNode } from 'react'
import { FolderOpen, Search } from 'lucide-react'

/**
 * A generic "part" from a persisted UIMessage. We work with plain JSON records
 * here rather than strongly-typed SDK types because the parts are stored and
 * reloaded as JSON — the tool names and state fields are all we need for
 * rendering.
 */
export interface ToolPart {
  type: string
  toolCallId?: string
  state?: string
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  errorText?: string
}

/** Extract the tool name from the part type, e.g. 'tool-search_records' → 'search_records'. */
export function toolNameFromPart(part: ToolPart): string {
  return part.type.startsWith('tool-') ? part.type.slice(5) : part.type
}

/** True while the model is still calling the tool or waiting for its result. */
export function isToolPartPending(part: ToolPart): boolean {
  return part.state === 'input-streaming' || part.state === 'input-available'
}

/** A small inline spinner — 12 px, no dependency. */
function Spinner(): ReactNode {
  return (
    <span
      aria-hidden
      className="inline-block size-3 animate-spin rounded-full border border-current border-t-transparent"
    />
  )
}

/** The chip shell: spinner while pending, icon when settled. */
function ChipFrame({
  pending,
  icon,
  children,
}: {
  pending: boolean
  icon: ReactNode
  children: ReactNode
}): ReactNode {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {pending ? <Spinner /> : icon}
      <span className="truncate">{children}</span>
    </span>
  )
}

function countSuffix(n: number, noun: string): string {
  return ` · ${n} ${noun}${n === 1 ? '' : 's'}`
}

function SearchRecordsChip({ part }: { part: ToolPart }): ReactNode {
  const pending = isToolPartPending(part)
  const query = String(part.input?.['query'] ?? '')
  const count = typeof part.output?.['count'] === 'number' ? part.output['count'] : null

  return (
    <ChipFrame pending={pending} icon={<Search aria-hidden className="size-3.5" />}>
      Searched "{query}"
      {!pending && count !== null ? countSuffix(count, 'result') : ''}
      {!pending && part.state === 'output-error' ? ` — ${part.errorText ?? 'error'}` : ''}
    </ChipFrame>
  )
}

function ListProjectsChip({ part }: { part: ToolPart }): ReactNode {
  const pending = isToolPartPending(part)
  const statusFilter = part.input?.['status'] ? String(part.input['status']) : null
  const count = typeof part.output?.['count'] === 'number' ? part.output['count'] : null

  return (
    <ChipFrame pending={pending} icon={<FolderOpen aria-hidden className="size-3.5" />}>
      {statusFilter ? `Listed ${statusFilter} projects` : 'Listed projects'}
      {!pending && count !== null ? countSuffix(count, 'project') : ''}
      {!pending && part.state === 'output-error' ? ` — ${part.errorText ?? 'error'}` : ''}
    </ChipFrame>
  )
}

interface ChatToolChipProps {
  part: ToolPart
}

/**
 * Compact transparent chip for one tool call/result. Spinner while pending,
 * icon + label + count when settled. Survives reload via persisted UIMessage
 * JSON — reading only `type`, `state`, `input`, `output`, and `errorText`.
 */
export function ChatToolChip({ part }: ChatToolChipProps): ReactNode {
  const toolName = toolNameFromPart(part)

  switch (toolName) {
    case 'search_records':
      return <SearchRecordsChip part={part} />
    case 'list_projects':
      return <ListProjectsChip part={part} />
    default:
      return (
        <ChipFrame
          pending={isToolPartPending(part)}
          icon={<Search aria-hidden className="size-3.5" />}
        >
          {toolName.replace(/_/g, ' ')}
        </ChipFrame>
      )
  }
}
