import type { ReactNode } from 'react'
import { FolderOpen, ListTodo, Search, TextSearch } from 'lucide-react'
import type { ChatSource } from './chat-sources'
import {
  isToolPartPending,
  toolNameFromPart,
  type ToolApprovalResponse,
  type ToolPart,
} from './chat-tool-state'
import { ChatToolSources } from './chat-tool-sources'
import { ChatWriteToolChip, isWriteToolName } from './chat-write-tool-chip'

export {
  isToolPartAwaitingApproval,
  isToolPartPending,
  messageHasAwaitingToolApproval,
  toolNameFromPart,
} from './chat-tool-state'
export type { ToolApprovalResponse, ToolPart } from './chat-tool-state'

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

/** Plural, human label for a record-type filter value. Falls back to the raw id. */
const RECORD_TYPE_LABEL: Record<string, string> = {
  interaction: 'interactions',
  interaction_transcript: 'transcripts',
  document: 'documents',
  task: 'tasks',
  person: 'people',
  organization: 'organizations',
  memory: 'memories',
  extracted_fact: 'facts',
  ai_note: 'notes',
  asset: 'files',
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/** A short phrase for a query-less browse, e.g. "recent emails, transcripts". */
function browseLabel(input: Record<string, unknown> | undefined): string {
  const kinds = stringArray(input?.['kinds'])
  const types = stringArray(input?.['recordTypes'])
  const nouns = kinds.length > 0 ? kinds : types.map((t) => RECORD_TYPE_LABEL[t] ?? t)
  const noun = nouns.length > 0 ? nouns.join(', ') : 'records'
  const recent = input?.['sort'] === 'recency' || Boolean(input?.['after'])
  return `${recent ? 'recent ' : ''}${noun}`
}

function SearchRecordsChip({
  part,
  onOpenSource,
}: {
  part: ToolPart
  onOpenSource?: (source: ChatSource) => void
}): ReactNode {
  const pending = isToolPartPending(part)
  const query = String(part.input?.['query'] ?? '').trim()
  const count = typeof part.output?.['count'] === 'number' ? part.output['count'] : null

  return (
    <div className="min-w-0">
      <ChipFrame pending={pending} icon={<Search aria-hidden className="size-3.5" />}>
        {query ? `Searched "${query}"` : `Browsed ${browseLabel(part.input)}`}
        {!pending && count !== null ? countSuffix(count, 'result') : ''}
        {!pending && part.state === 'output-error' ? ` — ${part.errorText ?? 'error'}` : ''}
      </ChipFrame>
      <ChatToolSources part={part} {...(onOpenSource ? { onOpenSource } : {})} />
    </div>
  )
}

function GetRecordsChip({
  part,
  onOpenSource,
}: {
  part: ToolPart
  onOpenSource?: (source: ChatSource) => void
}): ReactNode {
  const pending = isToolPartPending(part)
  const count = typeof part.output?.['count'] === 'number' ? part.output['count'] : null

  return (
    <div className="min-w-0">
      <ChipFrame pending={pending} icon={<TextSearch aria-hidden className="size-3.5" />}>
        Loaded records
        {!pending && count !== null ? countSuffix(count, 'record') : ''}
        {!pending && part.state === 'output-error' ? ` — ${part.errorText ?? 'error'}` : ''}
      </ChipFrame>
      <ChatToolSources part={part} {...(onOpenSource ? { onOpenSource } : {})} />
    </div>
  )
}

function ListTasksChip({
  part,
  onOpenSource,
}: {
  part: ToolPart
  onOpenSource?: (source: ChatSource) => void
}): ReactNode {
  const pending = isToolPartPending(part)
  const statuses = stringArray(part.input?.['statuses'])
  const count = typeof part.output?.['count'] === 'number' ? part.output['count'] : null

  return (
    <div className="min-w-0">
      <ChipFrame pending={pending} icon={<ListTodo aria-hidden className="size-3.5" />}>
        {statuses.length > 0 ? `Listed ${statuses.join(', ')} tasks` : 'Listed tasks'}
        {!pending && count !== null ? countSuffix(count, 'task') : ''}
        {!pending && part.state === 'output-error' ? ` — ${part.errorText ?? 'error'}` : ''}
      </ChipFrame>
      <ChatToolSources part={part} {...(onOpenSource ? { onOpenSource } : {})} />
    </div>
  )
}

function ListProjectsChip({
  part,
  onOpenSource,
}: {
  part: ToolPart
  onOpenSource?: (source: ChatSource) => void
}): ReactNode {
  const pending = isToolPartPending(part)
  const statusFilter = part.input?.['status'] ? String(part.input['status']) : null
  const count = typeof part.output?.['count'] === 'number' ? part.output['count'] : null

  return (
    <div className="min-w-0">
      <ChipFrame pending={pending} icon={<FolderOpen aria-hidden className="size-3.5" />}>
        {statusFilter ? `Listed ${statusFilter} projects` : 'Listed projects'}
        {!pending && count !== null ? countSuffix(count, 'project') : ''}
        {!pending && part.state === 'output-error' ? ` — ${part.errorText ?? 'error'}` : ''}
      </ChipFrame>
      <ChatToolSources part={part} {...(onOpenSource ? { onOpenSource } : {})} />
    </div>
  )
}

interface ChatToolChipProps {
  part: ToolPart
  onApprovalResponse?: (response: ToolApprovalResponse) => void | PromiseLike<void>
  onOpenSource?: (source: ChatSource) => void
}

/**
 * Compact transparent chip for one tool call/result. Spinner while pending,
 * icon + label + count when settled. Survives reload via persisted UIMessage
 * JSON — reading only `type`, `state`, `input`, `output`, and `errorText`.
 */
export function ChatToolChip({ part, onApprovalResponse, onOpenSource }: ChatToolChipProps): ReactNode {
  const toolName = toolNameFromPart(part)

  switch (toolName) {
    case 'search_records':
    case 'browse_records':
      return <SearchRecordsChip part={part} {...(onOpenSource ? { onOpenSource } : {})} />
    case 'get_records':
      return <GetRecordsChip part={part} {...(onOpenSource ? { onOpenSource } : {})} />
    case 'list_tasks':
      return <ListTasksChip part={part} {...(onOpenSource ? { onOpenSource } : {})} />
    case 'list_projects':
      return <ListProjectsChip part={part} {...(onOpenSource ? { onOpenSource } : {})} />
    default:
      if (isWriteToolName(toolName)) {
        return (
          <ChatWriteToolChip
            part={part}
            toolName={toolName}
            {...(onApprovalResponse ? { onApprovalResponse } : {})}
          />
        )
      }
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
