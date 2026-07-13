import type { ReactNode } from 'react'
import { Check, PencilLine, X } from 'lucide-react'
import { useTask } from '../../lib/queries'
import { Button } from '../button'
import {
  isToolPartAwaitingApproval,
  isToolPartPending,
  type ToolApprovalResponse,
  type ToolPart,
} from './chat-tool-state'

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

interface ApprovalField {
  path: string
  value: string
}

interface ToolApprovalTarget {
  label: string
  state: 'loading' | 'resolved' | 'unavailable'
  value: string
}

function approvalFieldValue(value: unknown): string {
  if (value === null) return 'Clear'
  if (typeof value === 'string') return value.length > 0 ? value : '“”'
  return String(value)
}

function approvalFields(input: Record<string, unknown> | undefined): ApprovalField[] {
  const fields: ApprovalField[] = []
  const pending = Object.entries(input ?? {})
    .reverse()
    .map(([path, value]) => ({ path, value }))

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) break
    const { path, value } = current
    if (value === undefined) continue
    if (Array.isArray(value)) {
      if (value.length === 0) {
        fields.push({ path, value: '[]' })
        continue
      }
      for (let index = value.length - 1; index >= 0; index -= 1) {
        pending.push({ path: `${path}[${index}]`, value: value[index] })
      }
      continue
    }
    if (typeof value === 'object' && value !== null) {
      const entries = Object.entries(value).filter((entry) => entry[1] !== undefined)
      if (entries.length === 0) {
        fields.push({ path, value: '{}' })
        continue
      }
      for (const [key, item] of entries.reverse()) {
        pending.push({ path: path ? `${path}.${key}` : key, value: item })
      }
      continue
    }
    fields.push({ path, value: approvalFieldValue(value) })
  }
  return fields
}

function WriteApprovalFields({
  input,
  label,
  target,
}: {
  input: Record<string, unknown> | undefined
  label: string
  target?: ToolApprovalTarget
}): ReactNode {
  const fields = approvalFields(input)
  if (fields.length === 0 && !target) return null

  return (
    <dl
      aria-label={`${label} fields`}
      className="grid max-h-48 max-w-full grid-cols-[minmax(5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-0.5 overflow-y-auto rounded-md border border-border/60 bg-muted/30 px-2 py-1.5"
    >
      {target ? (
        <div className="contents">
          <dt className="min-w-0 text-[11px] text-muted-foreground">{target.label}</dt>
          <dd
            className={
              target.state === 'resolved'
                ? 'min-w-0 break-words text-xs font-medium text-foreground'
                : 'min-w-0 break-words text-[11px] text-muted-foreground'
            }
          >
            {target.value}
          </dd>
        </div>
      ) : null}
      {fields.map((field) => (
        <div key={field.path} className="contents">
          <dt className="min-w-0 font-mono text-[11px] text-muted-foreground">{field.path}</dt>
          <dd className="min-w-0 whitespace-pre-wrap break-words text-[11px] text-foreground">
            {field.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

type ApprovalRowState = 'requested' | 'approved' | 'denied'

function WriteApprovalRow({
  part,
  toolName,
  state,
  displayInput,
  target,
  onApprovalResponse,
}: {
  part: ToolPart
  toolName: string
  state: ApprovalRowState
  displayInput?: Record<string, unknown>
  target?: ToolApprovalTarget
  onApprovalResponse?: (response: ToolApprovalResponse) => void | PromiseLike<void>
}): ReactNode {
  const title = WRITE_TOOL_LABEL[toolName] ?? toolName.replace(/_/g, ' ')
  const approvalId = part.approval?.id
  const decisionActive = state === 'requested' && approvalId !== undefined
  const approveActive = decisionActive && (target === undefined || target.state === 'resolved')
  const targetSuffix = target?.state === 'resolved' ? `: ${target.value}` : ''
  const approveLabel = state === 'approved'
    ? `Approved ${title.toLowerCase()}${targetSuffix}`
    : `Approve ${title.toLowerCase()}${targetSuffix}`
  const denyLabel = state === 'denied'
    ? `Denied ${title.toLowerCase()}${targetSuffix}`
    : `Deny ${title.toLowerCase()}${targetSuffix}`
  const statusText =
    state === 'requested' ? 'Needs approval' : state === 'approved' ? 'Approved' : 'Denied'
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
              <span className="font-medium text-foreground">{title}</span>
              <span className="text-[11px] text-muted-foreground">{statusText}</span>
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant={state === 'denied' ? 'outline' : 'ghost'}
            size="sm"
            aria-label={denyLabel}
            title={state === 'denied' ? 'Denied' : 'Deny'}
            disabled={!decisionActive}
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
            title={
              state === 'approved'
                ? 'Approved'
                : target && target.state !== 'resolved'
                  ? 'Task must be identified before approval'
                  : 'Approve'
            }
            disabled={!approveActive}
            onClick={() => {
              if (approvalId) onApprovalResponse?.({ id: approvalId, approved: true })
            }}
            className={approveButtonClass}
          >
            <Check aria-hidden className="size-3.5" />
          </Button>
        </span>
      </div>
      <WriteApprovalFields
        input={displayInput ?? part.input}
        label={title}
        {...(target ? { target } : {})}
      />
    </div>
  )
}

function BasicWriteToolChip({
  part,
  toolName,
  displayInput,
  target,
  onApprovalResponse,
}: {
  part: ToolPart
  toolName: string
  displayInput?: Record<string, unknown>
  target?: ToolApprovalTarget
  onApprovalResponse?: (response: ToolApprovalResponse) => void | PromiseLike<void>
}): ReactNode {
  const label = WRITE_TOOL_LABEL[toolName] ?? toolName.replace(/_/g, ' ')
  const contextProps = {
    ...(displayInput ? { displayInput } : {}),
    ...(target ? { target } : {}),
  }

  if (isToolPartAwaitingApproval(part)) {
    return (
      <WriteApprovalRow
        part={part}
        toolName={toolName}
        state="requested"
        {...contextProps}
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
        {...contextProps}
      />
    )
  }

  if (part.state === 'output-denied') {
    return <WriteApprovalRow part={part} toolName={toolName} state="denied" {...contextProps} />
  }

  if (part.state === 'output-error') {
    return (
      <div className="flex max-w-full flex-col gap-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <PencilLine aria-hidden className="size-3.5" />
          <span className="truncate">{label} failed — {part.errorText ?? 'error'}</span>
        </span>
        <WriteApprovalFields
          input={displayInput ?? part.input}
          label={label}
          {...(target ? { target } : {})}
        />
      </div>
    )
  }

  if (part.state === 'output-available') {
    return <WriteApprovalRow part={part} toolName={toolName} state="approved" {...contextProps} />
  }

  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {isToolPartPending(part) ? (
        <span
          aria-hidden
          className="inline-block size-3 animate-spin rounded-full border border-current border-t-transparent"
        />
      ) : (
        <PencilLine aria-hidden className="size-3.5" />
      )}
      <span className="truncate">{label}</span>
    </span>
  )
}

function nonBlankInputString(input: Record<string, unknown> | undefined, key: string): string | null {
  const value = input?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function taskDisplayInput(
  toolName: 'update_task' | 'complete_task',
  input: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const displayInput = Object.fromEntries(Object.entries(input ?? {}).filter(([key]) => key !== 'id'))
  if (toolName === 'complete_task' && !nonBlankInputString(input, 'completedAt')) {
    displayInput['completedAt'] = 'Now'
  }
  return displayInput
}

function ResolvedTaskWriteToolChip({
  part,
  toolName,
  taskId,
  onApprovalResponse,
}: {
  part: ToolPart
  toolName: 'update_task' | 'complete_task'
  taskId: string
  onApprovalResponse?: (response: ToolApprovalResponse) => void | PromiseLike<void>
}): ReactNode {
  const task = useTask(taskId)
  const taskTitle = task.data?.title.trim()
  const awaitingFreshTarget = isToolPartAwaitingApproval(part) && task.isFetching
  const target: ToolApprovalTarget = task.isPending || awaitingFreshTarget
    ? { label: 'Task', state: 'loading', value: 'Loading task…' }
    : task.isError || !taskTitle
      ? { label: 'Task', state: 'unavailable', value: 'Task unavailable — verify the ID below' }
      : { label: 'Task', state: 'resolved', value: taskTitle }

  return (
    <BasicWriteToolChip
      part={part}
      toolName={toolName}
      target={target}
      {...(target.state === 'unavailable'
        ? {}
        : { displayInput: taskDisplayInput(toolName, part.input) })}
      {...(onApprovalResponse ? { onApprovalResponse } : {})}
    />
  )
}

function TaskWriteToolChip({
  part,
  toolName,
  onApprovalResponse,
}: {
  part: ToolPart
  toolName: 'update_task' | 'complete_task'
  onApprovalResponse?: (response: ToolApprovalResponse) => void | PromiseLike<void>
}): ReactNode {
  const taskId = nonBlankInputString(part.input, 'id')
  if (!taskId) {
    return (
      <BasicWriteToolChip
        part={part}
        toolName={toolName}
        target={{ label: 'Task', state: 'unavailable', value: 'Task unavailable — missing ID' }}
        {...(onApprovalResponse ? { onApprovalResponse } : {})}
      />
    )
  }

  return (
    <ResolvedTaskWriteToolChip
      part={part}
      toolName={toolName}
      taskId={taskId}
      {...(onApprovalResponse ? { onApprovalResponse } : {})}
    />
  )
}

/** True when a tool name has a write-approval renderer. */
export function isWriteToolName(toolName: string): boolean {
  return Object.hasOwn(WRITE_TOOL_LABEL, toolName)
}

function shouldResolveTaskContext(part: ToolPart): boolean {
  return (
    isToolPartAwaitingApproval(part) ||
    part.state === 'approval-responded' ||
    part.state === 'output-denied' ||
    part.state === 'output-error' ||
    part.state === 'output-available'
  )
}

/** Render one write tool while keeping task identity checks separate from its mutation payload. */
export function ChatWriteToolChip({
  part,
  toolName,
  onApprovalResponse,
}: {
  part: ToolPart
  toolName: string
  onApprovalResponse?: (response: ToolApprovalResponse) => void | PromiseLike<void>
}): ReactNode {
  if (
    (toolName === 'update_task' || toolName === 'complete_task') &&
    shouldResolveTaskContext(part)
  ) {
    return (
      <TaskWriteToolChip
        part={part}
        toolName={toolName}
        {...(onApprovalResponse ? { onApprovalResponse } : {})}
      />
    )
  }
  return (
    <BasicWriteToolChip
      part={part}
      toolName={toolName}
      {...(onApprovalResponse ? { onApprovalResponse } : {})}
    />
  )
}
