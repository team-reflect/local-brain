import { useEffect, useRef, useState } from 'react'
import type { Task, TaskPatch } from '@local-brain/core'
import { useUpdateTask, type TaskWithIdentity } from '../../lib/queries'
import { errorMessage } from '../../lib/utils'

interface TaskForm {
  title: string
  description: string
  status: string
  priority: string
  projectId: string
  dueAt: string
  scheduledFor: string
  completedAt: string
}

interface DraftSnapshot {
  form: TaskForm
  error: string | null
  saveState: 'idle' | 'saving' | 'error'
}

interface TaskDraft extends DraftSnapshot {
  patchForm: (patch: Partial<TaskForm>) => void
  flush: () => Promise<void>
}

/**
 * Autosave for one keyed task editor. A write captures the current draft; edits
 * made during it become the next write. Blur and unmount flush the same draft.
 */
export function useTaskDraft(task: TaskWithIdentity): TaskDraft {
  const [snapshot, setSnapshot] = useState<DraftSnapshot>(() => ({
    form: stateFromTask(task),
    error: null,
    saveState: 'idle',
  }))
  const state = useRef({
    form: snapshot.form,
    saved: snapshot.form,
    saving: false,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    mounted: false,
    databaseIdentity: task.databaseIdentity,
  }).current
  const updateTask = useUpdateTask(task.id, state.databaseIdentity)

  useEffect(() => {
    state.mounted = true
    return () => {
      state.mounted = false
      void flush()
    }
  }, [])

  useEffect(() => {
    if (state.saving || !sameForm(state.form, state.saved)) return
    state.form = state.saved = stateFromTask(task)
    publish()
  }, [task])

  function publish(failure: string | null = null): void {
    if (!state.mounted) return
    const error = validateForm(state.form) ?? failure
    setSnapshot({
      form: state.form,
      error,
      saveState: error ? 'error' : state.saving || !sameForm(state.form, state.saved) ? 'saving' : 'idle',
    })
  }

  function patchForm(patch: Partial<TaskForm>): void {
    state.form = { ...state.form, ...patch }
    clearTimeout(state.timer)
    publish()
    if (!validateForm(state.form)) state.timer = setTimeout(() => void flush(), 350)
  }

  async function flush(): Promise<void> {
    clearTimeout(state.timer)
    if (state.saving) return
    if (validateForm(state.form) || sameForm(state.form, state.saved)) {
      publish()
      return
    }

    const attempted = state.form
    state.saving = true
    publish()
    let failure: string | null = null
    try {
      await updateTask.mutateAsync(toTaskPatch(attempted))
      state.saved = attempted
    } catch (cause) {
      failure = errorMessage(cause)
    } finally {
      state.saving = false
      // Compare drafts, not the saved baseline: reverting an in-flight edit
      // still needs a write after that edit commits.
      if (state.form !== attempted) void flush()
      else publish(failure)
    }
  }

  return { ...snapshot, patchForm, flush }
}

function validateForm(form: TaskForm): string | null {
  if (!form.title.trim()) return 'Title is required'
  if (!form.priority.trim()) return null
  const priority = Number(form.priority)
  return Number.isInteger(priority) && priority >= 0 ? null : 'Priority must be a whole number'
}

function toTaskPatch(form: TaskForm): TaskPatch {
  return {
    title: form.title.trim(),
    description: form.description,
    status: form.status,
    priority: form.priority.trim() === '' ? null : Number(form.priority),
    projectId: form.projectId || null,
    dueAt: form.dueAt || null,
    scheduledFor: form.scheduledFor || null,
    completedAt: form.status === 'done' ? form.completedAt || todayDate() : form.completedAt || null,
  }
}

function stateFromTask(task: Task): TaskForm {
  return {
    title: task.title,
    description: task.description ?? '',
    status: task.status,
    priority: task.priority == null ? '' : String(task.priority),
    projectId: task.projectId ?? '',
    dueAt: task.dueAt?.slice(0, 10) ?? '',
    scheduledFor: task.scheduledFor?.slice(0, 10) ?? '',
    completedAt: task.completedAt?.slice(0, 10) ?? '',
  }
}

function sameForm(a: TaskForm, b: TaskForm): boolean {
  return (Object.keys(a) as Array<keyof TaskForm>).every((key) => a[key] === b[key])
}

/** Local calendar date for a task's completion field. */
export function todayDate(): string {
  return new Date().toLocaleDateString('en-CA')
}
