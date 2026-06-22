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

interface PreviewField {
  label: string
  value: string
}

interface WriteToolPreview {
  title: string
  subject: string | null
  fields: PreviewField[]
}

const FIELD_LABEL: Record<string, string> = {
  bodyText: 'Body',
  completedAt: 'Completed',
  confidence: 'Confidence',
  description: 'Description',
  domain: 'Domain',
  dueAt: 'Due',
  endedAt: 'Ended',
  fullName: 'Name',
  headline: 'Headline',
  id: 'Id',
  industry: 'Industry',
  kind: 'Kind',
  location: 'Location',
  name: 'Name',
  notes: 'Notes',
  occurredAt: 'Occurred',
  participants: 'Participants',
  primaryEmail: 'Email',
  primaryPhone: 'Phone',
  priority: 'Priority',
  projectId: 'Project',
  scheduledFor: 'Scheduled',
  status: 'Status',
  subjects: 'Subjects',
  summary: 'Summary',
  targetDate: 'Target',
  title: 'Title',
  validFrom: 'Valid from',
  validTo: 'Valid to',
  website: 'Website',
}

const TOOL_FIELD_KEYS: Record<string, readonly string[]> = {
  create_task: ['description', 'status', 'priority', 'projectId', 'dueAt', 'scheduledFor'],
  update_task: ['title', 'description', 'status', 'priority', 'projectId', 'dueAt', 'scheduledFor'],
  complete_task: ['completedAt'],
  create_person: ['preferredName', 'headline', 'summary', 'primaryEmail', 'primaryPhone', 'location'],
  update_person: ['fullName', 'preferredName', 'headline', 'summary', 'primaryEmail', 'primaryPhone', 'location'],
  create_organization: ['kind', 'domain', 'headline', 'summary', 'website', 'industry', 'location'],
  update_organization: ['name', 'kind', 'domain', 'headline', 'summary', 'website', 'industry', 'location'],
  create_project: ['status', 'kind', 'summary', 'startedOn', 'targetDate', 'completedOn'],
  update_project: ['name', 'status', 'kind', 'summary', 'startedOn', 'targetDate', 'completedOn'],
  log_interaction: ['kind', 'occurredAt', 'endedAt', 'location', 'summary', 'bodyText'],
  remember_fact: ['kind', 'confidence', 'validFrom', 'validTo'],
  update_memory: ['claim', 'kind', 'confidence', 'validFrom', 'validTo'],
}

function humanizeKey(key: string): string {
  return FIELD_LABEL[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function scalarPreviewValue(value: unknown, showNullAsClear = false): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (value === null) return showNullAsClear ? 'Clear' : null
  return null
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

function previewField(
  input: Record<string, unknown> | undefined,
  key: string,
  showNullAsClear: boolean,
): PreviewField | null {
  const value = scalarPreviewValue(input?.[key], showNullAsClear)
  return value ? { label: humanizeKey(key), value } : null
}

function previewFields(
  input: Record<string, unknown> | undefined,
  keys: readonly string[],
  showNullAsClear: boolean,
): PreviewField[] {
  const fields: PreviewField[] = []
  for (const key of keys) {
    const field = previewField(input, key, showNullAsClear)
    if (field) fields.push(field)
  }
  return fields.slice(0, 4)
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function recordDisplayName(record: Record<string, unknown>): string | null {
  return (
    scalarPreviewValue(record['displayName']) ??
    scalarPreviewValue(record['handle']) ??
    scalarPreviewValue(record['personId']) ??
    scalarPreviewValue(record['recordId'])
  )
}

function arraySummary(input: Record<string, unknown> | undefined, key: string, noun: string): PreviewField | null {
  const value = input?.[key]
  if (!Array.isArray(value) || value.length === 0) return null

  const names = value.flatMap((item) => isRecord(item) ? [recordDisplayName(item)].filter((name) => name !== null) : [])
  const preview = names.slice(0, 2).join(', ')
  const remainder = value.length - names.slice(0, 2).length
  const label = preview
    ? `${preview}${remainder > 0 ? ` + ${remainder} more` : ''}`
    : countLabel(value.length, noun)
  return { label: humanizeKey(key), value: label }
}

function writePreview(toolName: string, input: Record<string, unknown> | undefined): WriteToolPreview {
  const title = WRITE_TOOL_LABEL[toolName] ?? toolName.replace(/_/g, ' ')
  const showNullAsClear = toolName.startsWith('update_')
  const fields = previewFields(input, TOOL_FIELD_KEYS[toolName] ?? Object.keys(input ?? {}), showNullAsClear)

  switch (toolName) {
    case 'create_task':
      return { title, subject: firstInputString(input, ['title']), fields }
    case 'update_task':
      return { title, subject: firstInputString(input, ['id', 'title']), fields }
    case 'complete_task':
      return { title, subject: firstInputString(input, ['id']), fields }
    case 'create_person':
      return { title, subject: firstInputString(input, ['fullName', 'preferredName']), fields }
    case 'update_person':
      return { title, subject: firstInputString(input, ['id', 'fullName', 'preferredName']), fields }
    case 'create_organization':
      return { title, subject: firstInputString(input, ['name', 'domain']), fields }
    case 'update_organization':
      return { title, subject: firstInputString(input, ['id', 'name', 'domain']), fields }
    case 'create_project':
      return { title, subject: firstInputString(input, ['name']), fields }
    case 'update_project':
      return { title, subject: firstInputString(input, ['id', 'name']), fields }
    case 'log_interaction': {
      const participants = arraySummary(input, 'participants', 'participant')
      return {
        title,
        subject: firstInputString(input, ['title', 'summary', 'bodyText']),
        fields: participants ? [participants, ...fields].slice(0, 4) : fields,
      }
    }
    case 'remember_fact': {
      const subjects = arraySummary(input, 'subjects', 'linked record')
      return {
        title,
        subject: firstInputString(input, ['claim']),
        fields: subjects ? [subjects, ...fields].slice(0, 4) : fields,
      }
    }
    case 'update_memory':
      return { title, subject: firstInputString(input, ['id', 'claim']), fields }
    default:
      return { title, subject: null, fields }
  }
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
    const preview = writePreview(toolName, part.input)
    const approveLabel = `Approve ${preview.title.toLowerCase()}`
    const denyLabel = `Deny ${preview.title.toLowerCase()}`
    return (
      <div className="flex max-w-full flex-col gap-1.5 text-xs text-muted-foreground">
        <div className="flex max-w-full flex-wrap items-start gap-2">
          <span className="flex min-w-0 flex-1 items-start gap-1.5">
            <PencilLine aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <span className="font-medium text-foreground">{preview.title}</span>
                <span className="text-[11px]">Needs approval</span>
              </span>
              {preview.subject ? (
                <span className="max-w-full truncate text-foreground">{preview.subject}</span>
              ) : null}
            </span>
          </span>
          {approvalId ? (
            <span className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={approveLabel}
                title="Approve"
                onClick={() => onApprovalResponse?.({ id: approvalId, approved: true })}
                className="h-6 w-6 px-0 py-0"
              >
                <Check aria-hidden className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={denyLabel}
                title="Deny"
                onClick={() => onApprovalResponse?.({ id: approvalId, approved: false })}
                className="h-6 w-6 px-0 py-0"
              >
                <X aria-hidden className="size-3.5" />
              </Button>
            </span>
          ) : null}
        </div>
        {preview.fields.length > 0 ? (
          <dl className="ml-5 grid max-w-xl grid-cols-[max-content_minmax(0,1fr)] gap-x-2 gap-y-1 text-[11px] leading-5">
            {preview.fields.map((field) => (
              <div key={`${field.label}:${field.value}`} className="contents">
                <dt className="text-muted-foreground">{field.label}</dt>
                <dd className="min-w-0 truncate text-foreground">{field.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
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
