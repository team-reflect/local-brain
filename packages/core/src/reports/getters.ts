import { db } from '../db/client'
import { localDateString, nowIso } from '../db/time'
import type { Task } from '../domains/tasks/getters'
import { OPEN_TASK_STATUSES, TERMINAL_TASK_STATUSES } from '../domains/tasks/lifecycle'
import {
  addDays,
  daysBetween,
  relationshipStrength,
  type RelationshipSignals,
} from '../domains/relationships/strength'

/**
 * Agent-facing retrieval endpoints (Plan 06, step 13). The daily brief, todo
 * list, "what changed", and waiting items are assembled here from durable typed
 * records so the Today surface, the `brain` CLI, and a daily automation all read
 * the same structured context — no per-caller queries, no separate report table.
 */

export { OPEN_TASK_STATUSES } from '../domains/tasks/lifecycle'

// Keep the pre-canonical US spelling terminal while existing local databases are corrected.
const TERMINAL = new Set<string>([...TERMINAL_TASK_STATUSES, 'canceled'])

export interface BriefTask {
  id: string
  title: string
  status: string
  dueAt: string | null
  scheduledFor: string | null
  priority: number | null
  projectId: string | null
  /** `overdue` | `today` | `soon` | `scheduled` | `open` */
  bucket: TaskBucket
  /** People responsible for doing the task (role='assignee'). */
  assignees: { id: string; name: string }[]
}

export type TaskBucket = 'overdue' | 'today' | 'soon' | 'scheduled' | 'open'

export interface BriefInteraction {
  id: string
  title: string | null
  kind: string
  occurredAt: string | null
  summary: string | null
  excerpt: string | null
  source: BriefSource | null
  participants: BriefParticipant[]
}

export interface BriefSource {
  name: string | null
  slug: string | null
  externalKind: string | null
}

export interface BriefParticipant {
  id: string | null
  name: string
  role: string | null
  handle: string | null
}

export interface BriefRelationshipContext {
  personId: string
  name: string
  headline: string | null
  lastInteractionAt: string | null
  relationshipStrength: number | null
  recentInteractions: number
  openTasks: number
}

export interface DailyBrief {
  generatedAt: string
  date: string
  tasks: {
    overdue: BriefTask[]
    today: BriefTask[]
    soon: BriefTask[]
    open: BriefTask[]
  }
  waitingItems: BriefTask[]
  recentInteractions: BriefInteraction[]
  recentChanges: ChangedRecord[]
  relationshipContext: BriefRelationshipContext[]
  counts: {
    openTasks: number
    overdueTasks: number
    dueToday: number
    waitingItems: number
    recentInteractions: number
    recentChanges: number
  }
}

export interface DailyBriefOptions {
  /** As-of instant for the generated brief date, task buckets, relationship hints, and change window. */
  now?: Date
  /** Window (days) for the "soon" bucket. */
  soonDays?: number
  /** How many recent interactions to include. */
  recentLimit?: number
  /** How many changed records to include. */
  changeLimit?: number
  /** How many relationship hints to include. */
  relationshipLimit?: number
}

const INTERACTION_EXCERPT_CHARS = 900
const INTERACTION_CHUNK_LIMIT = 2
const RECENT_CHANGE_DAYS = 2

function dayKey(date: Date): string {
  return localDateString(date)
}

function compactWhitespace(value: string | null | undefined): string | null {
  const compact = value?.replace(/\s+/g, ' ').trim()
  return compact ? compact : null
}

function clippedText(value: string | null | undefined, limit: number): string | null {
  const compact = compactWhitespace(value)
  if (!compact) return null
  if (compact.length <= limit) return compact
  return `${compact.slice(0, limit - 1).trimEnd()}…`
}

function bucketFor(task: { dueAt: string | null; scheduledFor: string | null }, now: Date, soonDays: number): TaskBucket {
  const today = dayKey(now)
  if (task.dueAt) {
    const due = task.dueAt.slice(0, 10)
    if (due < today) return 'overdue'
    if (due === today) return 'today'
    const soonCutoff = dayKey(new Date(now.getTime() + soonDays * 86_400_000))
    if (due <= soonCutoff) return 'soon'
  }
  if (task.scheduledFor) {
    const sched = task.scheduledFor.slice(0, 10)
    if (sched <= today) return 'today'
    return 'scheduled'
  }
  return 'open'
}

function toBriefTask(
  task: Task,
  bucket: TaskBucket,
  assignees: { id: string; name: string }[],
): BriefTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    dueAt: task.dueAt,
    scheduledFor: task.scheduledFor,
    priority: task.priority,
    projectId: task.projectId,
    bucket,
    assignees,
  }
}

interface BucketedBriefTasks {
  sourceTasks: Task[]
  overdue: BriefTask[]
  today: BriefTask[]
  soon: BriefTask[]
  open: BriefTask[]
  waitingItems: BriefTask[]
}

async function bucketedBriefTasks(now: Date, soonDays: number): Promise<BucketedBriefTasks> {
  const [openTasks, assigneeRows] = await Promise.all([
    db
      .selectFrom('tasks')
      .selectAll()
      .where('archivedAt', 'is', null)
      .where('status', 'in', [...OPEN_TASK_STATUSES])
      .orderBy('dueAt', 'asc')
      .execute(),
    db
      .selectFrom('taskPeople')
      .innerJoin('people', 'people.id', 'taskPeople.personId')
      .where('taskPeople.role', '=', 'assignee')
      .where('people.archivedAt', 'is', null)
      .select(['taskPeople.taskId', 'taskPeople.personId as id', 'people.fullName as name'])
      .execute(),
  ])

  const assigneeMap = new Map<string, { id: string; name: string }[]>()
  for (const row of assigneeRows) {
    const list = assigneeMap.get(row.taskId) ?? []
    list.push({ id: row.id, name: row.name })
    assigneeMap.set(row.taskId, list)
  }

  const overdue: BriefTask[] = []
  const today: BriefTask[] = []
  const soon: BriefTask[] = []
  const open: BriefTask[] = []
  const waitingItems: BriefTask[] = []
  for (const task of openTasks) {
    if (TERMINAL.has(task.status)) continue
    const bucket = bucketFor(task, now, soonDays)
    const assignees = assigneeMap.get(task.id) ?? []
    const brief = toBriefTask(task, bucket, assignees)
    if (task.status === 'waiting' || task.status === 'blocked') waitingItems.push(brief)
    if (bucket === 'overdue') overdue.push(brief)
    else if (bucket === 'today') today.push(brief)
    else if (bucket === 'soon') soon.push(brief)
    else open.push(brief)
  }

  return { sourceTasks: openTasks, overdue, today, soon, open, waitingItems }
}

interface RecentInteractionRow {
  id: string
  title: string | null
  kind: string
  occurredAt: string | null
  summary: string | null
  bodyText: string | null
}

async function interactionChunkMap(interactionIds: readonly string[]): Promise<Map<string, string[]>> {
  const byInteraction = new Map<string, string[]>()
  if (interactionIds.length === 0) return byInteraction

  const rows = await db
    .selectFrom('contentChunks')
    .select(['recordId', 'text', 'chunkIndex'])
    .where('recordType', '=', 'interaction')
    .where('recordId', 'in', [...interactionIds])
    .where('chunkIndex', '<', INTERACTION_CHUNK_LIMIT)
    .orderBy('recordId', 'asc')
    .orderBy('chunkIndex', 'asc')
    .execute()

  for (const row of rows) {
    const list = byInteraction.get(row.recordId) ?? []
    list.push(row.text)
    byInteraction.set(row.recordId, list)
  }
  return byInteraction
}

async function interactionParticipantMap(
  interactionIds: readonly string[],
): Promise<Map<string, BriefParticipant[]>> {
  const byInteraction = new Map<string, BriefParticipant[]>()
  if (interactionIds.length === 0) return byInteraction

  const rows = await db
    .selectFrom('interactionParticipants')
    .leftJoin('people', 'people.id', 'interactionParticipants.personId')
    .select([
      'interactionParticipants.interactionId',
      'interactionParticipants.personId as id',
      'interactionParticipants.role',
      'interactionParticipants.handle',
      'interactionParticipants.displayName',
      'people.fullName as fullName',
    ])
    .where('interactionParticipants.interactionId', 'in', [...interactionIds])
    .orderBy('interactionParticipants.createdAt', 'asc')
    .execute()

  for (const row of rows) {
    const list = byInteraction.get(row.interactionId) ?? []
    list.push({
      id: row.id,
      name: row.fullName ?? row.displayName ?? row.handle ?? 'Unknown participant',
      role: row.role,
      handle: row.handle,
    })
    byInteraction.set(row.interactionId, list)
  }
  return byInteraction
}

async function interactionSourceMap(interactionIds: readonly string[]): Promise<Map<string, BriefSource>> {
  const byInteraction = new Map<string, BriefSource>()
  if (interactionIds.length === 0) return byInteraction

  const identityRows = await db
    .selectFrom('externalIdentities')
    .leftJoin('sources', 'sources.id', 'externalIdentities.sourceId')
    .select([
      'externalIdentities.entityId',
      'externalIdentities.kind as externalKind',
      'sources.name as sourceName',
      'sources.slug as sourceSlug',
    ])
    .where('externalIdentities.entityType', '=', 'interaction')
    .where('externalIdentities.entityId', 'in', [...interactionIds])
    .orderBy('externalIdentities.createdAt', 'asc')
    .execute()

  for (const row of identityRows) {
    if (byInteraction.has(row.entityId)) continue
    if (!row.sourceName && !row.sourceSlug && !row.externalKind) continue
    byInteraction.set(row.entityId, {
      name: row.sourceName,
      slug: row.sourceSlug,
      externalKind: row.externalKind,
    })
  }

  const provenanceRows = await db
    .selectFrom('recordProvenance')
    .leftJoin('sources', 'sources.id', 'recordProvenance.sourceId')
    .leftJoin('externalIdentities', 'externalIdentities.id', 'recordProvenance.externalIdentityId')
    .select([
      'recordProvenance.recordId',
      'externalIdentities.kind as externalKind',
      'sources.name as sourceName',
      'sources.slug as sourceSlug',
    ])
    .where('recordProvenance.recordType', '=', 'interaction')
    .where('recordProvenance.recordId', 'in', [...interactionIds])
    .orderBy('recordProvenance.importedAt', 'desc')
    .orderBy('recordProvenance.createdAt', 'desc')
    .execute()

  for (const row of provenanceRows) {
    if (byInteraction.has(row.recordId)) continue
    if (!row.sourceName && !row.sourceSlug && !row.externalKind) continue
    byInteraction.set(row.recordId, {
      name: row.sourceName,
      slug: row.sourceSlug,
      externalKind: row.externalKind,
    })
  }

  return byInteraction
}

async function recentInteractions(limit: number): Promise<BriefInteraction[]> {
  const rows: RecentInteractionRow[] = await db
    .selectFrom('interactions')
    .select(['id', 'title', 'kind', 'occurredAt', 'summary', 'bodyText'])
    .where('archivedAt', 'is', null)
    .orderBy('occurredAt', 'desc')
    .orderBy('updatedAt', 'desc')
    .limit(limit)
    .execute()
  const ids = rows.map((row) => row.id)
  const [chunks, participants, sources] = await Promise.all([
    interactionChunkMap(ids),
    interactionParticipantMap(ids),
    interactionSourceMap(ids),
  ])

  return rows.map((interaction) => {
    const chunkExcerpt = chunks.get(interaction.id)?.join('\n\n')
    return {
      id: interaction.id,
      title: interaction.title,
      kind: interaction.kind,
      occurredAt: interaction.occurredAt,
      summary: clippedText(interaction.summary, INTERACTION_EXCERPT_CHARS),
      excerpt: clippedText(chunkExcerpt ?? interaction.bodyText, INTERACTION_EXCERPT_CHARS),
      source: sources.get(interaction.id) ?? null,
      participants: (participants.get(interaction.id) ?? []).slice(0, 8),
    }
  })
}

async function relationshipContext(now: Date, limit: number): Promise<BriefRelationshipContext[]> {
  const asOfIso = now.toISOString()
  const windowStartIso = addDays(asOfIso, -365)
  const [people, interactionRows, taskRows] = await Promise.all([
    db
      .selectFrom('people')
      .select(['id', 'fullName', 'headline'])
      .where('archivedAt', 'is', null)
      .where('isSelf', '=', 0)
      .execute(),
    db
      .selectFrom('interactionParticipants')
      .innerJoin('interactions', 'interactions.id', 'interactionParticipants.interactionId')
      .select([
        'interactionParticipants.personId',
        'interactionParticipants.interactionId',
        'interactions.occurredAt',
      ])
      .where('interactionParticipants.personId', 'is not', null)
      .where('interactions.archivedAt', 'is', null)
      .where('interactions.occurredAt', 'is not', null)
      .where('interactions.occurredAt', '<=', asOfIso)
      .execute(),
    db
      .selectFrom('taskPeople')
      .innerJoin('tasks', 'tasks.id', 'taskPeople.taskId')
      .select(['taskPeople.personId', 'taskPeople.taskId', 'tasks.status'])
      .where('tasks.archivedAt', 'is', null)
      .execute(),
  ])

  const interactionsByPerson = new Map<string, { recentIds: Set<string>; lastAt: string | null }>()
  for (const row of interactionRows) {
    if (!row.personId || !row.occurredAt) continue
    const signals = interactionsByPerson.get(row.personId) ?? { recentIds: new Set<string>(), lastAt: null }
    if (row.occurredAt >= windowStartIso) signals.recentIds.add(row.interactionId)
    if (signals.lastAt === null || row.occurredAt > signals.lastAt) signals.lastAt = row.occurredAt
    interactionsByPerson.set(row.personId, signals)
  }

  const openTaskIdsByPerson = new Map<string, Set<string>>()
  for (const row of taskRows) {
    if (TERMINAL.has(row.status)) continue
    const taskIds = openTaskIdsByPerson.get(row.personId) ?? new Set<string>()
    taskIds.add(row.taskId)
    openTaskIdsByPerson.set(row.personId, taskIds)
  }

  return people
    .map((person): BriefRelationshipContext | null => {
      const interactionSignals = interactionsByPerson.get(person.id)
      const lastInteractionAt = interactionSignals?.lastAt ?? null
      const signals: RelationshipSignals = {
        recentInteractions: interactionSignals?.recentIds.size ?? 0,
        daysSinceLast: lastInteractionAt ? daysBetween(lastInteractionAt, asOfIso) : null,
        openTasks: openTaskIdsByPerson.get(person.id)?.size ?? 0,
      }
      const strength = relationshipStrength(signals)
      if (strength === null) return null
      return {
        personId: person.id,
        name: person.fullName,
        headline: person.headline,
        lastInteractionAt,
        relationshipStrength: strength,
        recentInteractions: signals.recentInteractions,
        openTasks: signals.openTasks,
      }
    })
    .filter((context): context is BriefRelationshipContext => context !== null)
    .sort((a, b) => {
      const strength = (b.relationshipStrength ?? 0) - (a.relationshipStrength ?? 0)
      if (strength !== 0) return strength
      return (b.lastInteractionAt ?? '').localeCompare(a.lastInteractionAt ?? '')
    })
    .slice(0, limit)
}

/** Assemble the daily brief: bucketed open tasks and recent interactions. */
export async function getDailyBrief(options: DailyBriefOptions = {}): Promise<DailyBrief> {
  const now = options.now ?? new Date()
  const soonDays = options.soonDays ?? 7
  const recentLimit = options.recentLimit ?? 5
  const changeLimit = options.changeLimit ?? 12
  const relationshipLimit = options.relationshipLimit ?? 8
  const recentChangeSince = new Date(now.getTime() - RECENT_CHANGE_DAYS * 86_400_000).toISOString()
  const recentChangeUntil = now.toISOString()

  const [tasks, interactions, recentChanges, relationships] = await Promise.all([
    bucketedBriefTasks(now, soonDays),
    recentInteractions(recentLimit),
    getChangesSince(recentChangeSince, changeLimit, recentChangeUntil),
    relationshipContext(now, relationshipLimit),
  ])

  return {
    generatedAt: now.toISOString(),
    date: dayKey(now),
    tasks: {
      overdue: tasks.overdue,
      today: tasks.today,
      soon: tasks.soon,
      open: tasks.open,
    },
    waitingItems: tasks.waitingItems,
    recentInteractions: interactions,
    recentChanges,
    relationshipContext: relationships,
    counts: {
      openTasks: tasks.sourceTasks.length,
      overdueTasks: tasks.overdue.length,
      dueToday: tasks.today.length,
      waitingItems: tasks.waitingItems.length,
      recentInteractions: interactions.length,
      recentChanges: recentChanges.length,
    },
  }
}

export interface PlanDayOptions {
  now?: Date
  limit?: number
}

/**
 * A prioritized todo list for "plan my day": overdue first, then due today, then
 * scheduled/soon, then the rest — each group ordered by priority then due date.
 */
export async function planDay(options: PlanDayOptions = {}): Promise<BriefTask[]> {
  const now = options.now ?? new Date()
  const limit = options.limit ?? 25
  const tasks = await bucketedBriefTasks(now, 7)
  const ordered = [...tasks.overdue, ...tasks.today, ...tasks.soon, ...tasks.open]
  const byPriority = (a: BriefTask, b: BriefTask): number => {
    const pa = a.priority ?? 99
    const pb = b.priority ?? 99
    if (pa !== pb) return pa - pb
    return (a.dueAt ?? '~').localeCompare(b.dueAt ?? '~')
  }
  // Stable within-bucket priority sort, preserving the bucket order above.
  const buckets: BriefTask[][] = [[], [], [], []]
  const bucketIndex: Record<TaskBucket, number> = { overdue: 0, today: 1, soon: 2, scheduled: 2, open: 3 }
  for (const task of ordered) {
    const group = buckets[bucketIndex[task.bucket]]
    if (group) group.push(task)
  }
  return buckets.flatMap((group) => group.sort(byPriority)).slice(0, limit)
}

/** Tasks blocked on someone/something else. */
export function getWaitingItems(): Promise<Task[]> {
  return db
    .selectFrom('tasks')
    .selectAll()
    .where('archivedAt', 'is', null)
    .where('status', 'in', ['waiting', 'blocked'])
    .orderBy('updatedAt', 'desc')
    .execute()
}

export interface ChangedRecord {
  kind: 'person' | 'organization' | 'project' | 'task' | 'document' | 'interaction'
  id: string
  title: string
  updatedAt: string
}

/** Records created or updated since an ISO timestamp, newest first. */
export async function getChangesSince(
  sinceIso: string,
  limit = 50,
  untilIso?: string,
): Promise<ChangedRecord[]> {
  const since = sinceIso || nowIso()
  const until = untilIso || null
  const inWindow = (row: { updatedAt: string }): boolean => until === null || row.updatedAt <= until
  const [people, organizations, projects, tasks, documents, interactions] = await Promise.all([
    db
      .selectFrom('people')
      .select(['id', 'fullName as title', 'updatedAt'])
      .where('updatedAt', '>=', since)
      .where('archivedAt', 'is', null)
      .execute(),
    db
      .selectFrom('organizations')
      .select(['id', 'name as title', 'updatedAt'])
      .where('updatedAt', '>=', since)
      .where('archivedAt', 'is', null)
      .execute(),
    db
      .selectFrom('projects')
      .select(['id', 'name as title', 'updatedAt'])
      .where('updatedAt', '>=', since)
      .where('archivedAt', 'is', null)
      .execute(),
    db
      .selectFrom('tasks')
      .select(['id', 'title', 'updatedAt'])
      .where('updatedAt', '>=', since)
      .where('archivedAt', 'is', null)
      .execute(),
    db
      .selectFrom('documents')
      .select(['id', 'title', 'updatedAt'])
      .where('updatedAt', '>=', since)
      .where('archivedAt', 'is', null)
      .execute(),
    db
      .selectFrom('interactions')
      .select(['id', 'title', 'updatedAt'])
      .where('updatedAt', '>=', since)
      .where('archivedAt', 'is', null)
      .execute(),
  ])
  const tag = (kind: ChangedRecord['kind'], rows: { id: string; title: string | null; updatedAt: string }[]) =>
    rows.filter(inWindow).map((r) => ({ kind, id: r.id, title: r.title ?? '(untitled)', updatedAt: r.updatedAt }))
  return [
    ...tag('person', people),
    ...tag('organization', organizations),
    ...tag('project', projects),
    ...tag('task', tasks),
    ...tag('document', documents),
    ...tag('interaction', interactions),
  ]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
}
