import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Task } from '@local-brain/core'
import { AlertCircle } from 'lucide-react'
import { StatusBadge } from '../../components/badge'
import { Button } from '../../components/button'
import { DetailFields } from '../../components/detail-fields'
import { DetailPage } from '../../components/detail-page'
import { LinkedRecords } from '../../components/linked-records'
import { PageHead } from '../../components/page-head'
import { Input } from '../../components/ui/input'
import { NativeSelect } from '../../components/ui/native-select'
import { Textarea } from '../../components/ui/textarea'
import { useProjects, useTask, useTaskLinks, useUnlinkFrom, useUpdateTask } from '../../lib/queries'

const TASK_STATUSES = ['open', 'waiting', 'scheduled', 'done', 'canceled'] as const

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

export function TaskDetail({ id }: { id: string }): ReactNode {
  const task = useTask(id)
  const links = useTaskLinks(id)
  const onUnlink = useUnlinkFrom({ kind: 'task', id })
  const [editing, setEditing] = useState(false)

  return (
    <DetailPage query={task} notFoundTitle="Task not found">
      {(t) =>
        editing ? (
          <TaskEditView task={t} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} />
        ) : (
          <>
            <PageHead
              eyebrow="Task"
              title={t.title}
              actions={
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              }
            />
            <DetailFields
              fields={[
                { label: 'Status', value: <StatusBadge status={t.status} /> },
                { label: 'Priority', value: t.priority ?? '—' },
                { label: 'Due', value: toDateInput(t.dueAt) || '—' },
                { label: 'Scheduled', value: toDateInput(t.scheduledFor) || '—' },
                { label: 'Completed', value: toDateInput(t.completedAt) || '—' },
              ]}
            />
            {t.description ? <p className="text-sm text-foreground">{t.description}</p> : null}
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
        )
      }
    </DetailPage>
  )
}

function TaskEditView({
  task,
  onCancel,
  onSaved,
}: {
  task: Task
  onCancel: () => void
  onSaved: () => void
}): ReactNode {
  const titleRef = useRef<HTMLInputElement>(null)
  const projects = useProjects()
  const updateTask = useUpdateTask(task.id)
  const [form, setForm] = useState<TaskFormState>(() => stateFromTask(task))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setForm(stateFromTask(task))
    setError(null)
  }, [task])

  function patchForm(patch: Partial<TaskFormState>): void {
    setForm((current) => ({ ...current, ...patch }))
    if (error) setError(null)
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const title = form.title.trim()
    if (!title) {
      setError('Title is required')
      titleRef.current?.focus()
      return
    }

    const priority = form.priority.trim()
    const parsedPriority = priority === '' ? null : Number(priority)
    if (
      parsedPriority !== null &&
      (!Number.isInteger(parsedPriority) || parsedPriority < 0)
    ) {
      setError('Priority must be a whole number')
      return
    }

    const completedAt =
      form.status === 'done'
        ? form.completedAt || toDateInput(task.completedAt) || todayDate()
        : null

    setError(null)
    try {
      await updateTask.mutateAsync({
        title,
        description: form.description,
        status: form.status,
        priority: parsedPriority,
        projectId: form.projectId || null,
        dueAt: form.dueAt || null,
        scheduledFor: form.scheduledFor || null,
        completedAt,
      })
      onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save task')
    }
  }

  return (
    <>
      <PageHead eyebrow="Task" title="Edit task" />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-[hsl(var(--lb-ink-2))]">
          Title
          <Input
            ref={titleRef}
            value={form.title}
            onChange={(event) => patchForm({ title: event.target.value })}
            aria-invalid={error === 'Title is required' ? true : undefined}
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

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onCancel} disabled={updateTask.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={updateTask.isPending}>
            Save
          </Button>
        </div>
      </form>
    </>
  )
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

function toDateInput(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : ''
}

function todayDate(): string {
  return new Date().toLocaleDateString('en-CA')
}
