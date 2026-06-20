import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Task } from '@local-brain/core'
import { AlertCircle, Loader2 } from 'lucide-react'
import { StatusBadge } from '../../components/badge'
import { DetailPage } from '../../components/detail-page'
import { LinkedRecords } from '../../components/linked-records'
import { PageHead } from '../../components/page-head'
import { Input } from '../../components/ui/input'
import { NativeSelect } from '../../components/ui/native-select'
import { Textarea } from '../../components/ui/textarea'
import { cn } from '../../lib/utils'
import { useProjects, useTask, useTaskLinks, useUnlinkFrom, useUpdateTask } from '../../lib/queries'

const TASK_STATUSES = ['open', 'waiting', 'scheduled', 'done', 'canceled'] as const
const AUTOSAVE_DELAY_MS = 350

interface TaskFormState {
  title: string
  description: string
  status: string
  priority: string
  projectId: string
  dueAt: string
  scheduledFor: string
  completedAt: string
}

type EditableField = keyof TaskFormState
type SaveState = 'idle' | 'saving' | 'error'

export function TaskDetail({ id }: { id: string }): ReactNode {
  const task = useTask(id)
  const links = useTaskLinks(id)
  const onUnlink = useUnlinkFrom({ kind: 'task', id })

  return (
    <DetailPage query={task} notFoundTitle="Task not found">
      {(t) => (
        <>
          <TaskInlineEditor task={t} />
          {links.data ? (
            <>
              <LinkedRecords title="Project" records={links.data.projects} onUnlink={onUnlink} />
              {links.data.assignees.length > 0 ? (
                <LinkedRecords title="Assigned to" records={links.data.assignees} onUnlink={onUnlink} />
              ) : null}
              <LinkedRecords
                title="People"
                records={links.data.people.filter((p) => p.subtitle !== 'assignee')}
                onUnlink={onUnlink}
              />
              <LinkedRecords title="Documents" records={links.data.documents} onUnlink={onUnlink} />
              <LinkedRecords title="Interactions" records={links.data.interactions} onUnlink={onUnlink} />
            </>
          ) : null}
        </>
      )}
    </DetailPage>
  )
}

function TaskInlineEditor({ task }: { task: Task }): ReactNode {
  const projects = useProjects()
  const updateTask = useUpdateTask(task.id)
  const [activeField, setActiveField] = useState<EditableField | null>(null)
  const [form, setForm] = useState<TaskFormState>(() => stateFromTask(task))
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const skipAutosaveRef = useRef(true)
  const savedSnapshotRef = useRef(serializeState(stateFromTask(task)))

  useEffect(() => {
    const next = stateFromTask(task)
    savedSnapshotRef.current = serializeState(next)
    skipAutosaveRef.current = true
    setActiveField(null)
    setForm(next)
    setError(null)
    setSaveState('idle')
  }, [task])

  useEffect(() => {
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false
      return undefined
    }

    const serialized = serializeState(form)
    if (serialized === savedSnapshotRef.current) {
      setError(null)
      setSaveState('idle')
      return undefined
    }

    const validation = validateForm(form)
    if (validation !== null) {
      setError(validation)
      setSaveState('error')
      return undefined
    }

    setError(null)
    setSaveState('saving')
    const timeout = window.setTimeout(() => {
      void saveForm(form)
    }, AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(timeout)
  }, [form])

  async function saveForm(next: TaskFormState): Promise<void> {
    try {
      await updateTask.mutateAsync(toTaskPatch(next, task))
      savedSnapshotRef.current = serializeState(next)
      setSaveState('idle')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save task')
      setSaveState('error')
    }
  }

  function patchForm(patch: Partial<TaskFormState>): void {
    setForm((current) => ({ ...current, ...patch }))
  }

  function closeActiveField(): void {
    setActiveField(null)
  }

  const currentProjectName = projects.data?.find((project) => project.id === form.projectId)?.name
  const projectDisplay = form.projectId ? currentProjectName ?? 'Current project' : 'No project'

  return (
    <>
      <PageHead eyebrow="Task" title={displayTitle(form.title)} actions={<SaveIndicator state={saveState} />} />
      <div className="flex flex-col gap-3">
        <EditableShell label="Title" display={displayTitle(form.title)} onEdit={() => setActiveField('title')}>
          {activeField === 'title' ? (
            <Input
              autoFocus
              aria-label="Title"
              value={form.title}
              onBlur={closeActiveField}
              onChange={(event) => patchForm({ title: event.target.value })}
              aria-invalid={error === 'Title is required' ? true : undefined}
              className="text-base font-semibold"
            />
          ) : null}
        </EditableShell>

        <EditableShell
          label="Description"
          display={form.description || 'Click to add description'}
          muted={!form.description}
          multiline
          onEdit={() => setActiveField('description')}
        >
          {activeField === 'description' ? (
            <Textarea
              autoFocus
              aria-label="Description"
              value={form.description}
              onBlur={closeActiveField}
              onChange={(event) => patchForm({ description: event.target.value })}
              rows={4}
              className="min-h-24 font-normal"
            />
          ) : null}
        </EditableShell>

        <div className="grid gap-2 sm:grid-cols-2">
          <EditableShell
            label="Status"
            display={<StatusBadge status={form.status} />}
            onEdit={() => setActiveField('status')}
          >
            {activeField === 'status' ? (
              <NativeSelect
                autoFocus
                aria-label="Status"
                value={form.status}
                onBlur={closeActiveField}
                onChange={(event) => patchForm({ status: event.target.value })}
              >
                {TASK_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
          </EditableShell>

          <EditableShell
            label="Priority"
            display={form.priority || '—'}
            muted={!form.priority}
            onEdit={() => setActiveField('priority')}
          >
            {activeField === 'priority' ? (
              <Input
                autoFocus
                aria-label="Priority"
                value={form.priority}
                inputMode="numeric"
                pattern="[0-9]*"
                onBlur={closeActiveField}
                onChange={(event) => patchForm({ priority: event.target.value })}
                aria-invalid={error === 'Priority must be a whole number' ? true : undefined}
              />
            ) : null}
          </EditableShell>
        </div>

        <EditableShell label="Project" display={projectDisplay} onEdit={() => setActiveField('projectId')}>
          {activeField === 'projectId' ? (
            <NativeSelect
              autoFocus
              aria-label="Project"
              value={form.projectId}
              onBlur={closeActiveField}
              onChange={(event) => patchForm({ projectId: event.target.value })}
            >
              <option value="">No project</option>
              {projects.data?.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
              {form.projectId && !projects.data?.some((project) => project.id === form.projectId) ? (
                <option value={form.projectId}>Current project</option>
              ) : null}
            </NativeSelect>
          ) : null}
        </EditableShell>

        <div className="grid gap-2 sm:grid-cols-3">
          <DateEditableShell
            label="Due"
            field="dueAt"
            value={form.dueAt}
            activeField={activeField}
            setActiveField={setActiveField}
            closeActiveField={closeActiveField}
            patchForm={patchForm}
          />
          <DateEditableShell
            label="Scheduled"
            field="scheduledFor"
            value={form.scheduledFor}
            activeField={activeField}
            setActiveField={setActiveField}
            closeActiveField={closeActiveField}
            patchForm={patchForm}
          />
          <DateEditableShell
            label="Completed"
            field="completedAt"
            value={form.completedAt}
            activeField={activeField}
            setActiveField={setActiveField}
            closeActiveField={closeActiveField}
            patchForm={patchForm}
          />
        </div>

        {error ? (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="size-3.5" />
            {error}
          </p>
        ) : null}
      </div>
    </>
  )
}

function EditableShell({
  label,
  display,
  muted = false,
  multiline = false,
  onEdit,
  children,
}: {
  label: string
  display: ReactNode
  muted?: boolean
  multiline?: boolean
  onEdit: () => void
  children: ReactNode
}): ReactNode {
  if (children) {
    return (
      <label className="flex flex-col gap-1.5 text-xs font-medium text-[hsl(var(--lb-ink-2))]">
        {label}
        {children}
      </label>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[hsl(var(--lb-ink-2))]">{label}</span>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${label.toLowerCase()}`}
        className={cn(
          'flex min-h-8 w-full items-start justify-start rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
          multiline && 'min-h-16 whitespace-pre-wrap',
          muted && 'text-muted-foreground',
        )}
      >
        <span className={cn('min-w-0', multiline && 'block w-full')}>{display}</span>
      </button>
    </div>
  )
}

function DateEditableShell({
  label,
  field,
  value,
  activeField,
  setActiveField,
  closeActiveField,
  patchForm,
}: {
  label: string
  field: Extract<EditableField, 'dueAt' | 'scheduledFor' | 'completedAt'>
  value: string
  activeField: EditableField | null
  setActiveField: (field: EditableField) => void
  closeActiveField: () => void
  patchForm: (patch: Partial<TaskFormState>) => void
}): ReactNode {
  return (
    <EditableShell
      label={label}
      display={value || '—'}
      muted={!value}
      onEdit={() => setActiveField(field)}
    >
      {activeField === field ? (
        <Input
          autoFocus
          aria-label={label}
          type="date"
          value={value}
          onBlur={closeActiveField}
          onChange={(event) => patchForm({ [field]: event.target.value })}
        />
      ) : null}
    </EditableShell>
  )
}

function SaveIndicator({ state }: { state: SaveState }): ReactNode {
  if (state === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Saving
      </span>
    )
  }
  if (state === 'error') {
    return <span className="text-xs text-destructive">Not saved</span>
  }
  return null
}

function validateForm(form: TaskFormState): string | null {
  if (!form.title.trim()) return 'Title is required'
  const priority = form.priority.trim()
  if (priority === '') return null
  const parsedPriority = Number(priority)
  return Number.isInteger(parsedPriority) && parsedPriority >= 0
    ? null
    : 'Priority must be a whole number'
}

function toTaskPatch(form: TaskFormState, task: Task) {
  const priority = form.priority.trim()
  return {
    title: form.title.trim(),
    description: form.description,
    status: form.status,
    priority: priority === '' ? null : Number(priority),
    projectId: form.projectId || null,
    dueAt: form.dueAt || null,
    scheduledFor: form.scheduledFor || null,
    completedAt:
      form.status === 'done'
        ? form.completedAt || toDateInput(task.completedAt) || todayDate()
        : null,
  }
}

function stateFromTask(task: Task): TaskFormState {
  return {
    title: task.title,
    description: task.description ?? '',
    status: task.status,
    priority: task.priority == null ? '' : String(task.priority),
    projectId: task.projectId ?? '',
    dueAt: toDateInput(task.dueAt),
    scheduledFor: toDateInput(task.scheduledFor),
    completedAt: toDateInput(task.completedAt),
  }
}

function serializeState(state: TaskFormState): string {
  return JSON.stringify(state)
}

function displayTitle(title: string): string {
  return title.trim() || 'Untitled task'
}

function toDateInput(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : ''
}

function todayDate(): string {
  return new Date().toLocaleDateString('en-CA')
}
