import type { ReactNode } from 'react'
import { Check, FolderOpen, PencilLine, Search, X } from 'lucide-react'

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
  approval?: {
    id?: string
    approved?: boolean
  }
  errorText?: string
}

export interface ToolApprovalResponse {
  id: string
  approved: boolean
}

/** Extract the tool name from the part type, e.g. 'tool-search_records' → 'search_records'. */
export function toolNameFromPart(part: ToolPart): string {
  return part.type.startsWith('tool-') ? part.type.slice(5) : part.type
}

/** True while the model is still calling the tool or waiting for its result. */
export function isToolPartPending(part: ToolPart): boolean {
  return part.state === 'input-streaming' || part.state === 'input-available'
}

/** True when a write tool is paused on an explicit user approval decision. */
export function isToolPartAwaitingApproval(part: ToolPart): boolean {
  return part.state === 'approval-requested' && typeof part.approval?.id === 'string'
}

export function messageHasAwaitingToolApproval(message: {
  role?: string
  parts?: readonly unknown[]
}): boolean {
  return message.role === 'assistant' && (message.parts ?? []).some((part) => {
    const record = part as Record<string, unknown>
    return String(record['type'] ?? '').startsWith('tool-') &&
      isToolPartAwaitingApproval(record as unknown as ToolPart)
  })
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

const WRITE_TOOL_LABEL: Record<string, string> = {
  create_task: 'Create task',
  update_task: 'Update task',
  complete_task: 'Complete task',
  create_person: 'Create person',
  update_person: 'Update person',
  create_organization: 'Create organization',
  update_organization: 'Update organization',
  create_project: 'Create project',
  update_project: 'Update project',
  log_interaction: 'Log interaction',
  remember_fact: 'Remember fact',
  update_memory: 'Update memory',
}

function outputString(output: Record<string, unknown> | undefined, key: string): string | null {
  const value = output?.[key]
  return typeof value === 'string' ? value : null
}

function outputNumber(output: Record<string, unknown> | undefined, key: string): number | null {
  const value = output?.[key]
  return typeof value === 'number' ? value : null
}

function WriteToolChip({
  part,
  toolName,
  onApprovalResponse,
}: {
  part: ToolPart
  toolName: string
  onApprovalResponse?: (response: ToolApprovalResponse) => void | PromiseLike<void>
}): ReactNode {
  const label = WRITE_TOOL_LABEL[toolName] ?? toolName.replace(/_/g, ' ')
  const approvalId = part.approval?.id
  const action = outputString(part.output, 'action')
  const id = outputString(part.output, 'id')
  const affected = outputNumber(part.output, 'affected')

  if (isToolPartAwaitingApproval(part)) {
    return (
      <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <PencilLine aria-hidden className="size-3.5" />
          {label} needs approval
        </span>
        {approvalId ? (
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onApprovalResponse?.({ id: approvalId, approved: true })}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-card px-2 text-[11px] text-foreground hover:bg-secondary"
            >
              <Check aria-hidden className="size-3" />
              Approve
            </button>
            <button
              type="button"
              onClick={() => onApprovalResponse?.({ id: approvalId, approved: false })}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-card px-2 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X aria-hidden className="size-3" />
              Deny
            </button>
          </span>
        ) : null}
      </span>
    )
  }

  if (part.state === 'approval-responded') {
    return (
      <ChipFrame pending={false} icon={<PencilLine aria-hidden className="size-3.5" />}>
        {part.approval?.approved === false ? `Denied ${label.toLowerCase()}` : `Approved ${label.toLowerCase()}`}
      </ChipFrame>
    )
  }

  if (part.state === 'output-denied') {
    return (
      <ChipFrame pending={false} icon={<X aria-hidden className="size-3.5" />}>
        Denied {label.toLowerCase()}
      </ChipFrame>
    )
  }

  if (part.state === 'output-error') {
    return (
      <ChipFrame pending={false} icon={<PencilLine aria-hidden className="size-3.5" />}>
        {label} failed — {part.errorText ?? 'error'}
      </ChipFrame>
    )
  }

  if (part.state === 'output-available') {
    const suffix = id ? ` · ${id}` : affected !== null ? ` · ${affected} affected` : ''
    return (
      <ChipFrame pending={false} icon={<Check aria-hidden className="size-3.5" />}>
        {action ? `${label} ${action}` : `${label} done`}
        {suffix}
      </ChipFrame>
    )
  }

  return (
    <ChipFrame pending={isToolPartPending(part)} icon={<PencilLine aria-hidden className="size-3.5" />}>
      {label}
    </ChipFrame>
  )
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
  onApprovalResponse?: (response: ToolApprovalResponse) => void | PromiseLike<void>
}

/**
 * Compact transparent chip for one tool call/result. Spinner while pending,
 * icon + label + count when settled. Survives reload via persisted UIMessage
 * JSON — reading only `type`, `state`, `input`, `output`, and `errorText`.
 */
export function ChatToolChip({ part, onApprovalResponse }: ChatToolChipProps): ReactNode {
  const toolName = toolNameFromPart(part)

  switch (toolName) {
    case 'search_records':
      return <SearchRecordsChip part={part} />
    case 'list_projects':
      return <ListProjectsChip part={part} />
    default:
      if (WRITE_TOOL_LABEL[toolName]) {
        return (
          <WriteToolChip
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
