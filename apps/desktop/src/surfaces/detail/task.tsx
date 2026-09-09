import { useState, type ReactNode } from 'react'
import { TASK_STATUSES } from '@local-brain/core'
import { AlertCircle, Loader2 } from 'lucide-react'
import { StatusBadge } from '../../components/badge'
import { DetailPage } from '../../components/detail-page'
import { InlineEditableInput } from '../../components/inline-edit-input'
import { InlineEditableSelect } from '../../components/inline-edit-select'
import { InlineEditableTextarea } from '../../components/inline-edit-textarea'
import { LinkedRecords } from '../../components/linked-records'
import { PageHead } from '../../components/page-head'
import { TaskCompletionControl } from '../../components/task-completion-control'
import { useProjects, useTask, useTaskLinks, useUnlinkFrom, type TaskWithIdentity } from '../../lib/queries'

import { todayDate, useTaskDraft } from './use-task-draft'

const PRIORITY_OPTIONS = [
  { value: '1', label: 'High' },
  { value: '2', label: 'Normal' },
  { value: '3', label: 'Low' },
] as const
type EditableField = keyof ReturnType<typeof useTaskDraft>['form']
type SaveState = ReturnType<typeof useTaskDraft>['saveState']

export function TaskDetail({ id }: { id: string }): ReactNode {
  const task = useTask(id)
  const links = useTaskLinks(id)
  const onUnlink = useUnlinkFrom({ kind: 'task', id })

  return (
    <DetailPage query={task} notFoundTitle="Task not found">
      {(t) => (
        <>
          <TaskInlineEditor
            key={`${t.databaseIdentity.databasePath}:${t.databaseIdentity.generation}:${t.id}`}
            task={t}
          />
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

function TaskInlineEditor({ task }: { task: TaskWithIdentity }): ReactNode {
  const projects = useProjects()
  const { form, error, saveState, patchForm, flush } = useTaskDraft(task)
  const [activeField, setActiveField] = useState<EditableField | null>(null)
  const [completionPending, setCompletionPending] = useState(false)

  function patchStatus(status: string): void {
    patchForm({
      status,
      completedAt: status === 'done'
        ? form.completedAt || task.completedAt?.slice(0, 10) || todayDate()
        : '',
    })
  }

  function closeActiveField(): void {
    setActiveField(null)
    void flush()
  }

  const currentProjectName = projects.data?.find((project) => project.id === form.projectId)?.name
  const projectDisplay = form.projectId ? currentProjectName ?? 'Current project' : 'No project'

  return (
    <>
      <PageHead
        eyebrow="Task"
        title={displayTitle(form.title)}
        actions={(
          <>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <TaskCompletionControl
                id={task.id}
                title={displayTitle(form.title)}
                status={form.status}
                disabled={saveState !== 'idle'}
                onPendingChange={setCompletionPending}
              />
              {form.status === 'done' ? 'Completed' : 'Mark complete'}
            </span>
            <SaveIndicator state={saveState} />
          </>
        )}
      />
      <fieldset aria-label="Task details" aria-busy={completionPending} disabled={completionPending} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0 disabled:opacity-60">
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
                {statusLabel(status)}
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
          {([
            ['dueAt', 'Due'],
            ['scheduledFor', 'Scheduled'],
            ['completedAt', 'Completed'],
          ] as const).map(([field, label]) => (
            <InlineEditableInput
              key={field}
              label={label}
              type="date"
              value={form[field]}
              display={form[field] || '—'}
              muted={!form[field]}
              isEditing={activeField === field}
              onEdit={() => setActiveField(field)}
              onBlur={closeActiveField}
              onChange={(value) => patchForm({ [field]: value })}
            />
          ))}
        </div>

        {error ? (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="size-3.5" />
            {error}
          </p>
        ) : null}
      </fieldset>
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
  if (state === 'error') {
    return <span className="text-xs text-destructive">Not saved</span>
  }
  return null
}

function displayTitle(title: string): string {
  return title.trim() || 'Untitled task'
}

function priorityLabel(priority: string): string {
  if (!priority) return 'No priority'
  return PRIORITY_OPTIONS.find((option) => option.value === priority)?.label ?? `Priority ${priority}`
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}
