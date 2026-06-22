import { z } from 'zod'
import {
  createPerson,
  updatePerson,
  type NewPerson,
  type PersonPatch,
} from '../../domains/people/setters'
import {
  createOrganization,
  updateOrganization,
  type NewOrganization,
  type OrganizationPatch,
} from '../../domains/organizations/setters'
import {
  createProject,
  updateProject,
  type NewProject,
  type ProjectPatch,
} from '../../domains/projects/setters'
import {
  completeTask,
  createTask,
  updateTask,
  type NewTask,
  type TaskPatch,
} from '../../domains/tasks/setters'
import {
  createInteraction,
  type InteractionParticipantInput,
  type NewInteraction,
} from '../../domains/interactions/setters'
import {
  createMemory,
  updateMemory,
  type MemoryLinkInput,
  type MemoryPatch,
  type NewMemory,
} from '../../domains/memories/setters'

const MEMORY_KINDS = ['fact', 'preference', 'decision', 'commitment', 'instruction', 'risk', 'idea'] as const

const optionalString = z.string().optional()
const nullableString = z.string().nullable().optional()
const optionalNumber = z.number().nullable().optional()
const idField = z.string().min(1).describe('Existing Local Brain record id')
const memoryKind = z.enum(MEMORY_KINDS)

function compactObject<T extends object>(input: T): Partial<T> {
  const output: Partial<T> = {}
  for (const key of Object.keys(input) as Array<keyof T>) {
    const value = input[key]
    if (value !== undefined) output[key] = value
  }
  return output
}

function optionalNonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function requireAffected(kind: string, action: string, id: string, affected: number): number {
  if (affected === 0) {
    throw new Error(`No ${kind} was ${action}; check that "${id}" is still the correct id.`)
  }
  return affected
}

const taskFields = {
  title: z.string().min(1),
  description: nullableString,
  status: optionalString,
  priority: optionalNumber,
  projectId: nullableString.describe('Existing project id, or null to clear'),
  dueAt: nullableString.describe('Due date/time string stored as-is, usually ISO 8601'),
  scheduledFor: nullableString.describe('Scheduled date/time string stored as-is, usually ISO 8601'),
}

const taskPatchFields = {
  title: optionalString,
  description: nullableString,
  status: optionalString,
  priority: optionalNumber,
  projectId: nullableString.describe('Existing project id, or null to clear'),
  dueAt: nullableString.describe('Due date/time string stored as-is, usually ISO 8601'),
  scheduledFor: nullableString.describe('Scheduled date/time string stored as-is, usually ISO 8601'),
}

export const createTaskSchema = z.object(taskFields)
export const updateTaskSchema = z.object({ id: idField, ...taskPatchFields })
export const completeTaskSchema = z.object({
  id: idField,
  completedAt: optionalString.describe('Completion timestamp; omit to use the current time'),
})

const personFields = {
  fullName: z.string().min(1),
  preferredName: nullableString,
  headline: nullableString,
  summary: nullableString,
  primaryEmail: nullableString,
  primaryPhone: nullableString,
  location: nullableString,
  notes: nullableString,
}

const personPatchFields = {
  fullName: optionalString,
  preferredName: nullableString,
  headline: nullableString,
  summary: nullableString,
  primaryEmail: nullableString,
  primaryPhone: nullableString,
  location: nullableString,
  notes: nullableString,
}

export const createPersonSchema = z.object(personFields)
export const updatePersonSchema = z.object({ id: idField, ...personPatchFields })

const organizationFields = {
  name: z.string().min(1),
  kind: nullableString,
  domain: nullableString,
  headline: nullableString,
  summary: nullableString,
  website: nullableString,
  industry: nullableString,
  location: nullableString,
  notes: nullableString,
}

const organizationPatchFields = {
  name: optionalString,
  kind: nullableString,
  domain: nullableString,
  headline: nullableString,
  summary: nullableString,
  website: nullableString,
  industry: nullableString,
  location: nullableString,
  notes: nullableString,
}

export const createOrganizationSchema = z.object(organizationFields)
export const updateOrganizationSchema = z.object({ id: idField, ...organizationPatchFields })

const projectFields = {
  name: z.string().min(1),
  status: optionalString,
  kind: nullableString,
  summary: nullableString,
  notes: nullableString,
  startedOn: nullableString,
  targetDate: nullableString,
  completedOn: nullableString,
}

const projectPatchFields = {
  name: optionalString,
  status: optionalString,
  kind: nullableString,
  summary: nullableString,
  notes: nullableString,
  startedOn: nullableString,
  targetDate: nullableString,
  completedOn: nullableString,
}

export const createProjectSchema = z.object(projectFields)
export const updateProjectSchema = z.object({ id: idField, ...projectPatchFields })

const interactionParticipantSchema = z.object({
  personId: optionalString.describe('Existing person id when known'),
  role: nullableString,
  handle: nullableString,
  displayName: nullableString,
  sourceId: nullableString,
})

const memorySubjectSchema = z.object({
  recordType: z.enum(['person', 'organization', 'project', 'task', 'interaction']),
  recordId: idField,
  role: nullableString,
})

export const logInteractionSchema = z.object({
  kind: optionalString.describe('Interaction kind, e.g. meeting, call, email, message, note'),
  title: nullableString,
  bodyText: nullableString,
  summary: nullableString,
  occurredAt: nullableString,
  endedAt: nullableString,
  location: nullableString,
  participants: z.array(interactionParticipantSchema).optional(),
})

export const rememberFactSchema = z.object({
  claim: z.string().min(1),
  kind: memoryKind.optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  validFrom: nullableString,
  validTo: nullableString,
  subjects: z.array(memorySubjectSchema).optional(),
})

export const updateMemorySchema = z.object({
  id: idField,
  claim: optionalString,
  kind: memoryKind.optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  validFrom: nullableString,
  validTo: nullableString,
})

export const CHAT_WRITE_TOOL_NAMES = [
  'create_task',
  'update_task',
  'complete_task',
  'create_person',
  'update_person',
  'create_organization',
  'update_organization',
  'create_project',
  'update_project',
  'log_interaction',
  'remember_fact',
  'update_memory',
] as const

export type ChatWriteToolName = (typeof CHAT_WRITE_TOOL_NAMES)[number]

export interface ChatWriteToolOutput {
  kind: string
  action: string
  id: string
  affected?: number
}

export function isChatWriteToolName(name: string): name is ChatWriteToolName {
  return CHAT_WRITE_TOOL_NAMES.includes(name as ChatWriteToolName)
}

export async function executeChatWriteTool(
  toolName: ChatWriteToolName,
  input: Record<string, unknown>,
): Promise<ChatWriteToolOutput> {
  switch (toolName) {
    case 'create_task': {
      const parsed = createTaskSchema.parse(input)
      const id = await createTask(compactObject(parsed) as NewTask)
      return { kind: 'task', action: 'created', id }
    }
    case 'update_task': {
      const { id, ...patch } = updateTaskSchema.parse(input)
      const affected = await updateTask(id, compactObject(patch) as TaskPatch)
      return { kind: 'task', action: 'updated', id, affected: requireAffected('task', 'updated', id, affected) }
    }
    case 'complete_task': {
      const { id, completedAt } = completeTaskSchema.parse(input)
      const affected = await completeTask(id, optionalNonBlank(completedAt))
      return { kind: 'task', action: 'completed', id, affected: requireAffected('task', 'completed', id, affected) }
    }
    case 'create_person': {
      const parsed = createPersonSchema.parse(input)
      const id = await createPerson(compactObject(parsed) as NewPerson)
      return { kind: 'person', action: 'created', id }
    }
    case 'update_person': {
      const { id, ...patch } = updatePersonSchema.parse(input)
      const affected = await updatePerson(id, compactObject(patch) as PersonPatch)
      return { kind: 'person', action: 'updated', id, affected: requireAffected('person', 'updated', id, affected) }
    }
    case 'create_organization': {
      const parsed = createOrganizationSchema.parse(input)
      const id = await createOrganization(compactObject(parsed) as NewOrganization)
      return { kind: 'organization', action: 'created', id }
    }
    case 'update_organization': {
      const { id, ...patch } = updateOrganizationSchema.parse(input)
      const affected = await updateOrganization(id, compactObject(patch) as OrganizationPatch)
      return {
        kind: 'organization',
        action: 'updated',
        id,
        affected: requireAffected('organization', 'updated', id, affected),
      }
    }
    case 'create_project': {
      const parsed = createProjectSchema.parse(input)
      const id = await createProject(compactObject(parsed) as NewProject)
      return { kind: 'project', action: 'created', id }
    }
    case 'update_project': {
      const { id, ...patch } = updateProjectSchema.parse(input)
      const affected = await updateProject(id, compactObject(patch) as ProjectPatch)
      return { kind: 'project', action: 'updated', id, affected: requireAffected('project', 'updated', id, affected) }
    }
    case 'log_interaction': {
      const { participants, ...parsed } = logInteractionSchema.parse(input)
      const id = await createInteraction(
        compactObject(parsed) as NewInteraction,
        (participants ?? []) as InteractionParticipantInput[],
      )
      return { kind: 'interaction', action: 'created', id }
    }
    case 'remember_fact': {
      const { subjects, ...parsed } = rememberFactSchema.parse(input)
      const result = await createMemory(
        compactObject(parsed) as NewMemory,
        (subjects ?? []).map<MemoryLinkInput>((subject) => ({
          recordType: subject.recordType,
          recordId: subject.recordId,
          role: subject.role ?? null,
        })),
      )
      return { kind: 'memory', action: result.created ? 'created' : 'existing', id: result.id }
    }
    case 'update_memory': {
      const { id, ...patch } = updateMemorySchema.parse(input)
      const affected = await updateMemory(id, compactObject(patch) as MemoryPatch)
      return { kind: 'memory', action: 'updated', id, affected: requireAffected('memory', 'updated', id, affected) }
    }
  }
}
