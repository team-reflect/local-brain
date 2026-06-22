import type { ReactNode } from 'react'
import { Check, FolderOpen, PencilLine, Search, X } from 'lucide-react'
import { Button } from '../button'

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

interface WriteToolPreview {
  title: string
  subject: string | null
}

function inputString(input: Record<string, unknown> | undefined, key: string): string | null {
  const value = input?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function firstInputString(input: Record<string, unknown> | undefined, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = inputString(input, key)
    if (value) return value
  }
  return null
}

function writePreview(toolName: string, input: Record<string, unknown> | undefined): WriteToolPreview {
  const title = WRITE_TOOL_LABEL[toolName] ?? toolName.replace(/_/g, ' ')

  switch (toolName) {
    case 'create_task':
      return { title, subject: firstInputString(input, ['title']) }
    case 'update_task':
      return { title, subject: firstInputString(input, ['id', 'title']) }
    case 'complete_task':
      return { title, subject: firstInputString(input, ['id']) }
    case 'create_person':
      return { title, subject: firstInputString(input, ['fullName', 'preferredName']) }
    case 'update_person':
      return { title, subject: firstInputString(input, ['id', 'fullName', 'preferredName']) }
    case 'create_organization':
      return { title, subject: firstInputString(input, ['name', 'domain']) }
    case 'update_organization':
      return { title, subject: firstInputString(input, ['id', 'name', 'domain']) }
    case 'create_project':
      return { title, subject: firstInputString(input, ['name']) }
    case 'update_project':
      return { title, subject: firstInputString(input, ['id', 'name']) }
    case 'log_interaction':
      return { title, subject: firstInputString(input, ['title', 'summary', 'bodyText']) }
    case 'remember_fact':
      return { title, subject: firstInputString(input, ['claim']) }
    case 'update_memory':
      return { title, subject: firstInputString(input, ['id', 'claim']) }
    default:
      return { title, subject: null }
  }
}

type ApprovalRowState = 'requested' | 'approved' | 'denied'

function WriteApprovalRow({
  part,
  toolName,
  state,
  onApprovalResponse,
}: {
  part: ToolPart
  toolName: string
  state: ApprovalRowState
  onApprovalResponse?: (response: ToolApprovalResponse) => void | PromiseLike<void>
}): ReactNode {
  const preview = writePreview(toolName, part.input)
  const approvalId = part.approval?.id
  const active = state === 'requested' && approvalId !== undefined
  const approveLabel = state === 'approved'
    ? `Approved ${preview.title.toLowerCase()}`
    : `Approve ${preview.title.toLowerCase()}`
  const denyLabel = state === 'denied'
    ? `Denied ${preview.title.toLowerCase()}`
    : `Deny ${preview.title.toLowerCase()}`
  const statusText =
    state === 'requested' ? 'Needs approval' : state === 'approved' ? 'Approved' : 'Denied'
  const statusClass = 'text-[11px] text-muted-foreground'
  const denyButtonClass = state === 'denied'
    ? 'h-6 w-6 px-0 py-0 border-destructive/30 bg-destructive/5 text-destructive disabled:opacity-100'
    : 'h-6 w-6 px-0 py-0'
  const approveButtonClass = state === 'approved'
    ? 'h-6 w-6 px-0 py-0 border-emerald-200 bg-emerald-50 text-emerald-600 disabled:opacity-100'
    : 'h-6 w-6 px-0 py-0'

  return (
    <div className="flex max-w-full flex-col gap-1.5 text-xs text-muted-foreground">
      <div className="flex max-w-full flex-wrap items-start gap-2">
        <span className="flex min-w-0 flex-1 items-start gap-1.5">
          <PencilLine aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <span className="font-medium text-foreground">{preview.title}</span>
              <span className={statusClass}>{statusText}</span>
            </span>
            {preview.subject ? (
              <span className="max-w-full truncate text-foreground">{preview.subject}</span>
            ) : null}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant={state === 'denied' ? 'outline' : 'ghost'}
            size="sm"
            aria-label={denyLabel}
            title={state === 'denied' ? 'Denied' : 'Deny'}
            disabled={!active}
            onClick={() => {
              if (approvalId) onApprovalResponse?.({ id: approvalId, approved: false })
            }}
            className={denyButtonClass}
          >
            <X aria-hidden className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant={state === 'denied' ? 'ghost' : 'outline'}
            size="sm"
            aria-label={approveLabel}
            title={state === 'approved' ? 'Approved' : 'Approve'}
            disabled={!active}
            onClick={() => {
              if (approvalId) onApprovalResponse?.({ id: approvalId, approved: true })
            }}
            className={approveButtonClass}
          >
            <Check aria-hidden className="size-3.5" />
          </Button>
        </span>
      </div>
    </div>
  )
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

  if (isToolPartAwaitingApproval(part)) {
    return (
      <WriteApprovalRow
        part={part}
        toolName={toolName}
        state="requested"
        {...(onApprovalResponse ? { onApprovalResponse } : {})}
      />
    )
  }

  if (part.state === 'approval-responded') {
    return (
      <WriteApprovalRow
        part={part}
        toolName={toolName}
        state={part.approval?.approved === false ? 'denied' : 'approved'}
      />
    )
  }

  if (part.state === 'output-denied') {
    return <WriteApprovalRow part={part} toolName={toolName} state="denied" />
  }

  if (part.state === 'output-error') {
    return (
      <ChipFrame pending={false} icon={<PencilLine aria-hidden className="size-3.5" />}>
        {label} failed — {part.errorText ?? 'error'}
      </ChipFrame>
    )
  }

  if (part.state === 'output-available') {
    return <WriteApprovalRow part={part} toolName={toolName} state="approved" />
  }

  return (
    <ChipFrame pending={isToolPartPending(part)} icon={<PencilLine aria-hidden className="size-3.5" />}>
      {label}
    </ChipFrame>
  )
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

function SearchRecordsChip({ part }: { part: ToolPart }): ReactNode {
  const pending = isToolPartPending(part)
  const query = String(part.input?.['query'] ?? '').trim()
  const count = typeof part.output?.['count'] === 'number' ? part.output['count'] : null

  return (
    <ChipFrame pending={pending} icon={<Search aria-hidden className="size-3.5" />}>
      {query ? `Searched "${query}"` : `Browsed ${browseLabel(part.input)}`}
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
