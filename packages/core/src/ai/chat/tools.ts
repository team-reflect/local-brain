import { tool } from 'ai'
import { z } from 'zod'
import { retrieve, RETRIEVABLE_SOURCE_KINDS, type SourceRecordType } from '../../retrieval/retrieve'
import { listProjects } from '../../domains/projects/getters'
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

/**
 * AI SDK tools for Local Brain chat. One module owns tool names,
 * input/output shapes, and the execute implementations so the transport and
 * UI chip only need to import from here.
 *
 * Write tools are approval-gated with `needsApproval: true`; the UI must collect
 * an explicit Approve response before the execute function mutates SQLite.
 */

const DEFAULT_SEARCH_LIMIT = 8
const MAX_SEARCH_LIMIT = 20
const DEFAULT_PROJECTS_LIMIT = 30
const MAX_CHUNK_CHARS = 1200
const recordTypeEnum = z.enum([...RETRIEVABLE_SOURCE_KINDS] as [string, ...string[]])
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

function writeDescription(action: string): string {
  return `${action} Requires explicit user approval before it changes Local Brain.`
}

export function buildChatTools() {
  return {
    search_records: tool({
      description:
        'Search and browse Local Brain records — documents, interactions, transcripts, emails, tasks, people, and more. ' +
        'Pass `query` to search by topic or keyword. Add filters to narrow by record type (`recordTypes`), ' +
        'interaction kind (`kinds`, e.g. ["email"]), or date window (`after`/`before`), and `sort` to order by relevance or recency. ' +
        'To list RECENT items (e.g. "recent transcripts / emails"), OMIT `query` and instead set `recordTypes` ' +
        '(and `kinds` like ["email"]) with `sort: "recency"` and an `after` date — do not put "recent" in the query text. ' +
        'Each hit includes its record date so you can judge freshness.',
      inputSchema: z.object({
        query: optionalString.describe(
          'Topic or keywords. Omit to browse by filters (record type / kind / date) instead of searching.',
        ),
        recordTypes: z
          .array(recordTypeEnum)
          .optional()
          .describe(
            'Restrict to these record types. Use ["interaction_transcript"] for transcripts, ["interaction"] for emails/meetings/calls, ["document"] for docs.',
          ),
        kinds: z
          .array(z.string())
          .optional()
          .describe(
            'Restrict interactions to these kinds (e.g. email, meeting, call, message, note). Use ["email"] for emails only.',
          ),
        after: optionalString.describe(
          'Only records on/after this ISO 8601 (UTC) date. For "recent", use a date one or two weeks before today.',
        ),
        before: optionalString.describe('Only records on/before this ISO 8601 (UTC) date.'),
        sort: z
          .enum(['relevance', 'recency'])
          .optional()
          .describe('relevance (default with a query) or recency (newest first; default when browsing without a query).'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_SEARCH_LIMIT)
          .optional()
          .describe(`Max results to return (default ${DEFAULT_SEARCH_LIMIT})`),
      }),
      execute: async ({ query, recordTypes, kinds, after, before, sort, limit }) => {
        const trimmedQuery = optionalNonBlank(query)
        const hasFilter =
          (recordTypes?.length ?? 0) > 0 || (kinds?.length ?? 0) > 0 || Boolean(after) || Boolean(before)
        if (!trimmedQuery && !hasFilter) {
          throw new Error(
            'Provide a query or at least one filter (recordTypes, kinds, after, before). ' +
              'To list recent items, set recordTypes (and kinds) with sort:"recency" and an after date.',
          )
        }
        const result = await retrieve(trimmedQuery ?? '', {
          mode: 'hybrid',
          limit: limit ?? DEFAULT_SEARCH_LIMIT,
          ...(recordTypes && recordTypes.length > 0
            ? { recordTypes: recordTypes as SourceRecordType[] }
            : {}),
          ...(kinds && kinds.length > 0 ? { kinds } : {}),
          ...(after ? { after } : {}),
          ...(before ? { before } : {}),
          ...(sort ? { sort } : {}),
        })
        return {
          hits: result.chunks.map((chunk) => ({
            recordType: chunk.recordType,
            recordId: chunk.recordId,
            title: chunk.recordTitle ?? null,
            date: chunk.recordDate ?? null,
            snippet: chunk.snippet,
            text: chunk.text.length > MAX_CHUNK_CHARS ? chunk.text.slice(0, MAX_CHUNK_CHARS) : chunk.text,
          })),
          count: result.chunks.length,
          semanticAvailable: result.semanticAvailable,
        }
      },
    }),

    create_task: tool({
      description: writeDescription(
        'Create a task after the user asks to track a concrete follow-up or action item.',
      ),
      inputSchema: z.object(taskFields),
      needsApproval: true,
      execute: async (input) => {
        const id = await createTask(compactObject(input) as NewTask)
        return { kind: 'task', action: 'created', id }
      },
    }),

    update_task: tool({
      description: writeDescription(
        'Update an existing task by id. Only call this after resolving the task id; ask the user if the target is ambiguous.',
      ),
      inputSchema: z.object({ id: idField, ...taskPatchFields }),
      needsApproval: true,
      execute: async ({ id, ...patch }) => {
        const affected = await updateTask(id, compactObject(patch) as TaskPatch)
        return { kind: 'task', action: 'updated', id, affected: requireAffected('task', 'updated', id, affected) }
      },
    }),

    complete_task: tool({
      description: writeDescription('Mark an existing task done by id.'),
      inputSchema: z.object({
        id: idField,
        completedAt: optionalString.describe('Completion timestamp; omit to use the current time'),
      }),
      needsApproval: true,
      execute: async ({ id, completedAt }) => {
        const affected = await completeTask(id, optionalNonBlank(completedAt))
        return { kind: 'task', action: 'completed', id, affected: requireAffected('task', 'completed', id, affected) }
      },
    }),

    create_person: tool({
      description: writeDescription('Create a person record for a real person the user wants in the brain.'),
      inputSchema: z.object(personFields),
      needsApproval: true,
      execute: async (input) => {
        const id = await createPerson(compactObject(input) as NewPerson)
        return { kind: 'person', action: 'created', id }
      },
    }),

    update_person: tool({
      description: writeDescription(
        'Update an existing person by id. Only call this after resolving the person id; ask when ambiguous.',
      ),
      inputSchema: z.object({ id: idField, ...personPatchFields }),
      needsApproval: true,
      execute: async ({ id, ...patch }) => {
        const affected = await updatePerson(id, compactObject(patch) as PersonPatch)
        return { kind: 'person', action: 'updated', id, affected: requireAffected('person', 'updated', id, affected) }
      },
    }),

    create_organization: tool({
      description: writeDescription('Create an organization record for a real company, group, or institution.'),
      inputSchema: z.object(organizationFields),
      needsApproval: true,
      execute: async (input) => {
        const id = await createOrganization(compactObject(input) as NewOrganization)
        return { kind: 'organization', action: 'created', id }
      },
    }),

    update_organization: tool({
      description: writeDescription(
        'Update an existing organization by id. Only call this after resolving the organization id; ask when ambiguous.',
      ),
      inputSchema: z.object({ id: idField, ...organizationPatchFields }),
      needsApproval: true,
      execute: async ({ id, ...patch }) => {
        const affected = await updateOrganization(id, compactObject(patch) as OrganizationPatch)
        return {
          kind: 'organization',
          action: 'updated',
          id,
          affected: requireAffected('organization', 'updated', id, affected),
        }
      },
    }),

    create_project: tool({
      description: writeDescription(
        'Create a project only when the user explicitly agrees to that project boundary.',
      ),
      inputSchema: z.object(projectFields),
      needsApproval: true,
      execute: async (input) => {
        const id = await createProject(compactObject(input) as NewProject)
        return { kind: 'project', action: 'created', id }
      },
    }),

    update_project: tool({
      description: writeDescription(
        'Update an existing project by id. Prefer list_projects to resolve project ids first.',
      ),
      inputSchema: z.object({ id: idField, ...projectPatchFields }),
      needsApproval: true,
      execute: async ({ id, ...patch }) => {
        const affected = await updateProject(id, compactObject(patch) as ProjectPatch)
        return { kind: 'project', action: 'updated', id, affected: requireAffected('project', 'updated', id, affected) }
      },
    }),

    log_interaction: tool({
      description: writeDescription(
        'Create an interaction note for a meeting, call, email, message, or other user-confirmed contact event.',
      ),
      inputSchema: z.object({
        kind: optionalString.describe('Interaction kind, e.g. meeting, call, email, message, note'),
        title: nullableString,
        bodyText: nullableString,
        summary: nullableString,
        occurredAt: nullableString,
        endedAt: nullableString,
        location: nullableString,
        participants: z.array(interactionParticipantSchema).optional(),
      }),
      needsApproval: true,
      execute: async ({ participants, ...input }) => {
        const id = await createInteraction(
          compactObject(input) as NewInteraction,
          (participants ?? []) as InteractionParticipantInput[],
        )
        return { kind: 'interaction', action: 'created', id }
      },
    }),

    remember_fact: tool({
      description: writeDescription(
        'Store a concise durable memory, optionally linked to existing people, organizations, projects, tasks, or interactions.',
      ),
      inputSchema: z.object({
        claim: z.string().min(1),
        kind: memoryKind.optional(),
        confidence: z.number().min(0).max(1).nullable().optional(),
        validFrom: nullableString,
        validTo: nullableString,
        subjects: z.array(memorySubjectSchema).optional(),
      }),
      needsApproval: true,
      execute: async ({ subjects, ...input }) => {
        const result = await createMemory(
          compactObject(input) as NewMemory,
          (subjects ?? []).map<MemoryLinkInput>((subject) => ({
            recordType: subject.recordType,
            recordId: subject.recordId,
            role: subject.role ?? null,
          })),
        )
        return { kind: 'memory', action: result.created ? 'created' : 'existing', id: result.id }
      },
    }),

    update_memory: tool({
      description: writeDescription(
        'Update an existing memory by id. Use this for correcting the claim, kind, confidence, or validity dates.',
      ),
      inputSchema: z.object({
        id: idField,
        claim: optionalString,
        kind: memoryKind.optional(),
        confidence: z.number().min(0).max(1).nullable().optional(),
        validFrom: nullableString,
        validTo: nullableString,
      }),
      needsApproval: true,
      execute: async ({ id, ...patch }) => {
        const affected = await updateMemory(id, compactObject(patch) as MemoryPatch)
        return { kind: 'memory', action: 'updated', id, affected: requireAffected('memory', 'updated', id, affected) }
      },
    }),

    list_projects: tool({
      description:
        'List Local Brain projects with their names, statuses, summaries, and target dates. ' +
        'Use this to answer questions about active work, project progress, or deadlines.',
      inputSchema: z.object({
        status: z
          .string()
          .optional()
          .describe('Filter by project status (e.g. "active", "paused", "completed")'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe(`Max projects to return (default ${DEFAULT_PROJECTS_LIMIT})`),
      }),
      execute: async ({ status, limit }) => {
        const projects = await listProjects({
          ...(status !== undefined ? { status } : { activeOnly: true }),
          limit: limit ?? DEFAULT_PROJECTS_LIMIT,
        })
        return {
          projects: projects.map((p) => ({
            id: p.id,
            name: p.name,
            status: p.status ?? null,
            summary: p.summary ?? null,
            targetDate: p.targetDate ?? null,
            completedOn: p.completedOn ?? null,
          })),
          count: projects.length,
        }
      },
    }),
  }
}

export type ChatTools = ReturnType<typeof buildChatTools>
