import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Task } from '@local-brain/core'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { DetailPage } from '../../components/detail-page'
import { LinkedRecords } from '../../components/linked-records'
import { PageHead } from '../../components/page-head'
import { Input } from '../../components/ui/input'
import { NativeSelect } from '../../components/ui/native-select'
import { Textarea } from '../../components/ui/textarea'
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

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

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
  const [form, setForm] = useState<TaskFormState>(() => stateFromTask(task))
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const skipAutosaveRef = useRef(true)
  const savedSnapshotRef = useRef(serializeState(stateFromTask(task)))

  useEffect(() => {
    const next = stateFromTask(task)
    const serialized = serializeState(next)
    savedSnapshotRef.current = serialized
    skipAutosaveRef.current = true
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
      setSaveState('saved')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save task')
      setSaveState('error')
    }
  }

  function patchForm(patch: Partial<TaskFormState>): void {
    setForm((current) => ({ ...current, ...patch }))
  }

  return (
    <>
      <PageHead eyebrow="Task" title="Task" actions={<SaveIndicator state={saveState} />} />
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-[hsl(var(--lb-ink-2))]">
          Title
          <Input
            value={form.title}
            onChange={(event) => patchForm({ title: event.target.value })}
            aria-invalid={error === 'Title is required' ? true : undefined}
            className="text-base font-semibold"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-xs font-medium text-[hsl(var(--lb-ink-2))]">
          Description
          <Textarea
            value={form.description}
            onChange={(event) => patchForm({ description: event.target.value })}
            rows={4}
            className="min-h-24 font-normal"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-[hsl(var(--lb-ink-2))]">
            Status
            <NativeSelect
              value={form.status}
              onChange={(event) => patchForm({ status: event.target.value })}
            >
              {TASK_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </NativeSelect>
          </label>

          <label className="flex flex-col gap-1.5 text-xs font-medium text-[hsl(var(--lb-ink-2))]">
            Priority
            <Input
              value={form.priority}
              inputMode="numeric"
              pattern="[0-9]*"
              onChange={(event) => patchForm({ priority: event.target.value })}
              aria-invalid={error === 'Priority must be a whole number' ? true : undefined}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5 text-xs font-medium text-[hsl(var(--lb-ink-2))]">
          Project
          <NativeSelect
            value={form.projectId}
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
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-[hsl(var(--lb-ink-2))]">
            Due
            <Input
              type="date"
              value={form.dueAt}
              onChange={(event) => patchForm({ dueAt: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-[hsl(var(--lb-ink-2))]">
            Scheduled
            <Input
              type="date"
              value={form.scheduledFor}
              onChange={(event) => patchForm({ scheduledFor: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-[hsl(var(--lb-ink-2))]">
            Completed
            <Input
              type="date"
              value={form.completedAt}
              onChange={(event) => patchForm({ completedAt: event.target.value })}
            />
          </label>
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

function SaveIndicator({ state }: { state: SaveState }): ReactNode {
  if (state === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Saving
      </span>
    )
  }
  if (state === 'saved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <CheckCircle2 className="size-3.5" />
        Saved
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

function toDateInput(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : ''
}

function todayDate(): string {
  return new Date().toLocaleDateString('en-CA')
}
