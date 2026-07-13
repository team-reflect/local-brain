import { installFakeBridge } from './utils'

export interface RawTaskRow {
  id: string
  title: string
  description: string | null
  status: string
  priority: number | null
  project_id: string | null
  due_at: string | null
  scheduled_for: string | null
  completed_at: string | null
  origin_document_id: string | null
  origin_interaction_id: string | null
  source_record_type: string | null
  source_record_id: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

export interface CapturedCompletionWrite {
  id: string
  status: 'done' | 'open'
  completedAt: string | null
}

interface MutableTaskBridgeOptions {
  tasks: RawTaskRow[]
  query?: (sql: string, params: unknown[]) => unknown[] | undefined
  completionWrite?: Promise<number>
}

export interface DeferredCompletionWrite {
  promise: Promise<number>
  reject: (error: Error) => void
}

const FIXED_TIME = '2026-07-13T08:00:00.000Z'

export function rawTaskRow(overrides: Partial<RawTaskRow> = {}): RawTaskRow {
  return {
    id: 'task-1',
    title: 'Test task',
    description: null,
    status: 'open',
    priority: null,
    project_id: null,
    due_at: null,
    scheduled_for: null,
    completed_at: null,
    origin_document_id: null,
    origin_interaction_id: null,
    source_record_type: null,
    source_record_id: null,
    created_at: FIXED_TIME,
    updated_at: FIXED_TIME,
    archived_at: null,
    ...overrides,
  }
}

export function deferredCompletionWrite(): DeferredCompletionWrite {
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<number>((_resolve, rejectPromise) => {
    reject = rejectPromise
  })
  return { promise, reject }
}

/** Install task reads backed by mutable rows and capture reversible completion writes. */
export function installMutableTaskBridge({
  tasks,
  query,
  completionWrite,
}: MutableTaskBridgeOptions): CapturedCompletionWrite[] {
  const writes: CapturedCompletionWrite[] = []

  installFakeBridge({
    query: (sql, params) => {
      const customRows = query?.(sql, params)
      if (customRows !== undefined) return customRows
      if (sql.includes('from "tasks"')) return tasks
      return []
    },
    respond: (command, args) => {
      const sql = String(args['sql'] ?? '')
      if (command !== 'db_execute' || !sql.includes('update "tasks"')) return undefined

      const params = (args['params'] as unknown[]) ?? []
      const status = params[0]
      const id = params.at(-1)
      if ((status !== 'done' && status !== 'open') || typeof id !== 'string') return undefined

      const completedAt = typeof params[1] === 'string' || params[1] === null ? params[1] : null
      writes.push({ id, status, completedAt })
      if (completionWrite) return completionWrite

      const row = tasks.find((task) => task.id === id)
      if (row) {
        row.status = status
        row.completed_at = completedAt
        if (typeof params[2] === 'string') row.updated_at = params[2]
      }
      return 1
    },
  })

  return writes
}
