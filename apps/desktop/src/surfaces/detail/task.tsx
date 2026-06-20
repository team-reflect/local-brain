import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Task } from '@local-brain/core'
import { AlertCircle, Loader2 } from 'lucide-react'
import { StatusBadge } from '../../components/badge'
import { DetailPage } from '../../components/detail-page'
import { InlineEditableInput } from '../../components/inline-edit-input'
import { InlineEditableSelect } from '../../components/inline-edit-select'
import { InlineEditableTextarea } from '../../components/inline-edit-textarea'
import { LinkedRecords } from '../../components/linked-records'
import { PageHead } from '../../components/page-head'
import { useProjects, useTask, useTaskLinks, useUnlinkFrom, useUpdateTask } from '../../lib/queries'

const TASK_STATUSES = ['open', 'waiting', 'scheduled', 'done', 'canceled'] as const
const PRIORITY_OPTIONS = [
  { value: '1', label: 'High' },
  { value: '2', label: 'Normal' },
  { value: '3', label: 'Low' },
] as const
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
          <TaskInlineEditor key={t.id} task={t} />
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
  const formRef = useRef(form)
  const taskRef = useRef(task)
  const taskIdRef = useRef(task.id)
  const mountedRef = useRef(true)
  const inFlightSaveRef = useRef(false)
  const pendingSaveRef = useRef<TaskFormState | null>(null)
  const skipAutosaveRef = useRef(true)
  const savedSnapshotRef = useRef(serializeState(stateFromTask(task)))

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestSave(formRef.current)
    }
  }, [])

  useEffect(() => {
    taskRef.current = task
    const next = stateFromTask(task)
    if (task.id !== taskIdRef.current) {
      taskIdRef.current = task.id
      pendingSaveRef.current = null
      resetForm(next, { clearActiveField: true })
      return
    }

    if (!hasUnsavedChanges(formRef.current) && !inFlightSaveRef.current && pendingSaveRef.current === null) {
      resetForm(next, { clearActiveField: false })
    }
  }, [task])

  useEffect(() => {
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false
      return undefined
    }

    const serialized = serializeState(form)
    if (serialized === savedSnapshotRef.current) {
      if (mountedRef.current) {
        setError(null)
        setSaveState('idle')
      }
      return undefined
    }

    const validation = validateForm(form)
    if (validation !== null) {
      if (mountedRef.current) {
        setError(validation)
        setSaveState('error')
      }
      return undefined
    }

    if (mountedRef.current) {
      setError(null)
      setSaveState('saving')
    }
    const timeout = window.setTimeout(() => {
      requestSave(form)
    }, AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(timeout)
  }, [form])

  async function drainSaveQueue(): Promise<void> {
    if (inFlightSaveRef.current) return
    const next = pendingSaveRef.current
    if (next === null) return

    pendingSaveRef.current = null
    const serialized = serializeState(next)
    if (serialized === savedSnapshotRef.current) {
      if (mountedRef.current) setSaveState('idle')
      if (pendingSaveRef.current !== null) void drainSaveQueue()
      return
    }

    const validation = validateForm(next)
    if (validation !== null) {
      if (mountedRef.current) {
        setError(validation)
        setSaveState('error')
      }
      return
    }

    inFlightSaveRef.current = true
    try {
      await updateTask.mutateAsync(toTaskPatch(next))
      savedSnapshotRef.current = serializeState(next)
      if (mountedRef.current) {
        setError(null)
        setSaveState(pendingSaveRef.current === null ? 'idle' : 'saving')
      }
    } catch (cause) {
      if (mountedRef.current) {
        setError(cause instanceof Error ? cause.message : 'Could not save task')
        setSaveState('error')
      }
    } finally {
      inFlightSaveRef.current = false
      if (pendingSaveRef.current !== null) void drainSaveQueue()
    }
  }

  function requestSave(next: TaskFormState): void {
    if (serializeState(next) === savedSnapshotRef.current) return
    const validation = validateForm(next)
    if (validation !== null) {
      if (mountedRef.current) {
        setError(validation)
        setSaveState('error')
      }
      return
    }

    pendingSaveRef.current = next
    if (mountedRef.current) {
      setError(null)
      setSaveState('saving')
    }
    void drainSaveQueue()
  }

  function resetForm(
    next: TaskFormState,
    { clearActiveField }: { clearActiveField: boolean },
  ): void {
    formRef.current = next
    savedSnapshotRef.current = serializeState(next)
    skipAutosaveRef.current = true
    if (clearActiveField) setActiveField(null)
    setForm(next)
    setError(null)
    setSaveState('idle')
  }

  function hasUnsavedChanges(next: TaskFormState): boolean {
    return serializeState(next) !== savedSnapshotRef.current
  }

  function patchForm(patch: Partial<TaskFormState>): void {
    setForm((current) => {
      const next = { ...current, ...patch }
      formRef.current = next
      return next
    })
  }

  function patchStatus(status: string): void {
    setForm((current) => {
      const next = {
        ...current,
        status,
        completedAt:
          status === 'done'
            ? current.completedAt || toDateInput(taskRef.current.completedAt) || todayDate()
            : '',
      }
      formRef.current = next
      return next
    })
  }

  function closeActiveField(): void {
    setActiveField(null)
    requestSave(formRef.current)
  }

  const currentProjectName = projects.data?.find((project) => project.id === form.projectId)?.name
  const projectDisplay = form.projectId ? currentProjectName ?? 'Current project' : 'No project'

  return (
    <>
      <PageHead eyebrow="Task" title={displayTitle(form.title)} actions={<SaveIndicator state={saveState} />} />
      <div className="flex flex-col gap-3">
        <InlineEditableInput
          label="Title"
          value={form.title}
          display={displayTitle(form.title)}
          isEditing={activeField === 'title'}
          onEdit={() => setActiveField('title')}
          onBlur={closeActiveField}
          onChange={(title) => patchForm({ title })}
          ariaInvalid={error === 'Title is required'}
        />

        <InlineEditableTextarea
          label="Description"
          display={form.description || 'Click to add description'}
          value={form.description}
          muted={!form.description}
          isEditing={activeField === 'description'}
          onEdit={() => setActiveField('description')}
          onBlur={closeActiveField}
          onChange={(description) => patchForm({ description })}
          rows={4}
          inputClassName="min-h-24"
        />

        <div className="grid gap-2 sm:grid-cols-2">
          <InlineEditableSelect
            label="Status"
            display={<StatusBadge status={form.status} />}
            value={form.status}
            isEditing={activeField === 'status'}
            onEdit={() => setActiveField('status')}
            onBlur={closeActiveField}
            onChange={patchStatus}
          >
            {TASK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </InlineEditableSelect>

          <InlineEditableSelect
            label="Priority"
            display={priorityLabel(form.priority)}
            value={form.priority}
            muted={!form.priority}
            isEditing={activeField === 'priority'}
            onEdit={() => setActiveField('priority')}
            onBlur={closeActiveField}
            onChange={(priority) => patchForm({ priority })}
            ariaInvalid={error === 'Priority must be a whole number'}
          >
            <option value="">No priority</option>
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            {form.priority && !PRIORITY_OPTIONS.some((option) => option.value === form.priority) ? (
              <option value={form.priority}>{`Current priority (${form.priority})`}</option>
            ) : null}
          </InlineEditableSelect>
        </div>

        <InlineEditableSelect
          label="Project"
          display={projectDisplay}
          value={form.projectId}
          isEditing={activeField === 'projectId'}
          onEdit={() => setActiveField('projectId')}
          onBlur={closeActiveField}
          onChange={(projectId) => patchForm({ projectId })}
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
        </InlineEditableSelect>

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
    <InlineEditableInput
      label={label}
      type="date"
      value={value}
      display={value || '—'}
      muted={!value}
      isEditing={activeField === field}
      onEdit={() => setActiveField(field)}
      onBlur={closeActiveField}
      onChange={(nextValue) => patchForm({ [field]: nextValue })}
    />
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

function toTaskPatch(form: TaskFormState) {
  const priority = form.priority.trim()
  return {
    title: form.title.trim(),
    description: form.description,
    status: form.status,
    priority: priority === '' ? null : Number(priority),
    projectId: form.projectId || null,
    dueAt: form.dueAt || null,
    scheduledFor: form.scheduledFor || null,
    completedAt: form.status === 'done' ? form.completedAt || todayDate() : form.completedAt || null,
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

function priorityLabel(priority: string): string {
  if (!priority) return 'No priority'
  return PRIORITY_OPTIONS.find((option) => option.value === priority)?.label ?? `Priority ${priority}`
}

function toDateInput(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : ''
}

function todayDate(): string {
  return new Date().toLocaleDateString('en-CA')
}
