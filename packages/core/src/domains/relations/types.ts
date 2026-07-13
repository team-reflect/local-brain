/**
 * A compact, navigable reference to a record that is linked to another record
 * through one of the typed join tables. Detail pages render these in
 * linked-record sections; the graph builds nodes/edges from the same shape.
 *
 * `subtitle` is a short secondary line (a role, status, date, or headline) and
 * is `null` when there is nothing useful to show. `kind` maps directly onto the
 * typed route for that record (except `memory`, which has no detail route).
 */
export type RecordKind =
  | 'person'
  | 'organization'
  | 'project'
  | 'task'
  | 'document'
  | 'interaction'
  | 'asset'
  | 'memory'

export interface LinkedRecord {
  kind: RecordKind
  id: string
  title: string
  subtitle: string | null
}

/**
 * A task reference with the workflow fields needed by actionable task rows.
 *
 * It remains assignable to {@link LinkedRecord} so correction handlers can unlink
 * it without learning a second relationship shape.
 */
export interface LinkedTask extends LinkedRecord {
  kind: 'task'
  status: string
  dueAt: string | null
  scheduledFor: string | null
  priority: number | null
}
