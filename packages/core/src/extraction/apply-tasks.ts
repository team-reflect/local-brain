import { db } from '../db/client'
import { newId } from '../db/id'
import { TASK_PERSON_ROLE_ASSIGNEE } from '../domains/tasks/getters'
import type { ExtractionResult } from './contracts'
import { normalizeName } from './match'
import { loadTaskCandidates } from './apply-store'
import type { ApplyContext } from './apply-context'
import type { DatabaseIdentity } from '../db/identity'

/**
 * Task applier for {@link applyExtraction}. A task depending on a gated/unresolved
 * entity (its project, people, or organizations) would land partial — with a
 * missing project or dropped links — so the whole task is held back as a
 * suggestion rather than written incomplete. A title-duplicate of an existing
 * task is reused (linked + evidenced) without mutating its fields (correction 05b).
 */
export async function applyTasks(
  ctx: ApplyContext,
  tasks: ExtractionResult['tasks'],
  databaseIdentity: DatabaseIdentity,
): Promise<void> {
  const candidates = await loadTaskCandidates(databaseIdentity)
  for (const task of tasks) {
    if (!ctx.accepts(task.confidence)) {
      ctx.suggest('task', task.ref, task.title, task.confidence)
      continue
    }
    const deps = [
      ...(task.projectRef != null ? [task.projectRef] : []),
      ...task.assigneeRefs,
      ...task.personRefs,
      ...task.organizationRefs,
    ]
    if (ctx.hasUnresolved(deps)) {
      ctx.suggest('task', task.ref, task.title, task.confidence)
      continue
    }
    const projectId =
      task.projectRef != null ? (ctx.resolved.get(task.projectRef)?.id ?? null) : null

    const normalizedTitle = normalizeName(task.title)
    const dup = candidates.find((c) => normalizeName(c.title) === normalizedTitle)
    if (dup) {
      ctx.resolve(task.ref, 'task', dup.id)
      ctx.summary.tasks.matched++
      ctx.pushEvidence('task', dup.id, task.evidence)
      continue
    }

    const id = newId()
    ctx.inserts.tasks.push(
      db.insertInto('tasks').values({
        id,
        title: task.title,
        description: task.description ?? null,
        ...(task.status != null ? { status: task.status } : {}),
        priority: task.priority ?? null,
        projectId,
        dueAt: task.dueAt ?? null,
        scheduledFor: task.scheduledFor ?? null,
        ...(ctx.source.recordType === 'document'
          ? { originDocumentId: ctx.source.recordId }
          : { originInteractionId: ctx.source.recordId }),
      }),
    )
    candidates.push({ id, title: task.title })
    ctx.resolve(task.ref, 'task', id)
    ctx.summary.tasks.created++

    // Insert assignees with role='assignee'; track their person ids to dedup
    // both duplicate refs within assigneeRefs and overlap with personRefs.
    const assigneePersonIds = new Set<string>()
    for (const assigneeRef of task.assigneeRefs) {
      const person = ctx.resolved.get(assigneeRef)
      if (person?.type === 'person' && !assigneePersonIds.has(person.id)) {
        assigneePersonIds.add(person.id)
        ctx.inserts.links.push(
          db.insertInto('taskPeople').values({
            id: newId(),
            taskId: id,
            personId: person.id,
            role: TASK_PERSON_ROLE_ASSIGNEE,
          }),
        )
        ctx.summary.links.created++
      }
    }
    // Generic person links (role=null); skip those already inserted as assignee.
    for (const personRef of task.personRefs) {
      const person = ctx.resolved.get(personRef)
      if (person?.type === 'person' && !assigneePersonIds.has(person.id)) {
        ctx.inserts.links.push(
          db.insertInto('taskPeople').values({ id: newId(), taskId: id, personId: person.id }),
        )
        ctx.summary.links.created++
      }
    }
    for (const organizationRef of task.organizationRefs) {
      const organization = ctx.resolved.get(organizationRef)
      if (organization?.type === 'organization') {
        ctx.inserts.links.push(
          db
            .insertInto('taskOrganizations')
            .values({ id: newId(), taskId: id, organizationId: organization.id }),
        )
        ctx.summary.links.created++
      }
    }
    ctx.pushEvidence('task', id, task.evidence)
  }
}
