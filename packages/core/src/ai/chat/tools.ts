import { tool } from 'ai'
import { z } from 'zod'
import { filteredSearch, type FilteredSearchInput } from '../../retrieval/filtered-search'
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
const DEFAULT_SEARCH_EXCERPTS = 1
const MAX_SEARCH_EXCERPTS = 3
const DEFAULT_PROJECTS_LIMIT = 30
const MAX_CHUNK_CHARS = 1200
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

const searchRecordType = z.enum(['document', 'interaction', 'interaction_transcript', 'task'])
const searchSort = z.enum(['relevance', 'recent', 'oldest', 'updated'])
const searchDateField = z.enum(['effective', 'created', 'updated'])

const searchDateSchema = z.object({
  from: optionalString.describe('Inclusive lower bound, usually ISO 8601 or YYYY-MM-DD'),
  to: optionalString.describe('Inclusive upper bound, usually ISO 8601 or YYYY-MM-DD'),
  field: searchDateField.optional().describe('Which date field to filter; default effective'),
})

const searchHasSchema = z.object({
  transcript: z.boolean().optional().describe('Require or exclude transcript-backed records'),
  text: z.boolean().optional().describe('Require or exclude records with readable text'),
  sourceIdentity: z.boolean().optional().describe('Require or exclude source/provenance identity'),
})

const searchLinkedSchema = z.object({
  people: z.array(z.string().min(1)).optional().describe('Local Brain person ids'),
  organizations: z.array(z.string().min(1)).optional().describe('Local Brain organization ids'),
  projects: z.array(z.string().min(1)).optional().describe('Local Brain project ids'),
  tasks: z.array(z.string().min(1)).optional().describe('Local Brain task ids'),
})

function writeDescription(action: string): string {
  return `${action} Requires explicit user approval before it changes Local Brain.`
}

export function buildChatTools() {
  return {
    search_records: tool({
      description:
        'Search Local Brain records with optional semantic/hybrid text search and structured filters. ' +
        'Use query for topics/facts, and filters for record type, source kind, date, transcript presence, task status, or linked record ids. ' +
        'Returns grounded excerpts plus record metadata.',
      inputSchema: z.object({
        query: z.string().min(1).optional().describe('Search query — plain language or keywords. Omit for metadata-only recent/source searches.'),
        recordTypes: z.array(searchRecordType).optional().describe('Restrict to record types; default documents, interactions, and transcripts'),
        documentKinds: z.array(z.string().min(1)).optional().describe('Document kind filters, ORed together'),
        interactionKinds: z.array(z.string().min(1)).optional().describe('Interaction kind filters, e.g. email, meeting, call'),
        taskStatuses: z.array(z.string().min(1)).optional().describe('Task status filters, e.g. open, waiting, done'),
        date: searchDateSchema.optional().describe('Date filter over effective, created, or updated date'),
        has: searchHasSchema.optional().describe('Trait filters, e.g. transcript true'),
        sourceSlugs: z.array(z.string().min(1)).optional().describe('Source slugs, e.g. gmail, granola'),
        externalKinds: z.array(z.string().min(1)).optional().describe('External identity kinds, e.g. thread, transcript'),
        linked: searchLinkedSchema.optional().describe('Restrict to records linked to these Local Brain ids'),
        sort: searchSort.optional().describe('Sort order; default relevance with query, recent without query'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_SEARCH_LIMIT)
          .optional()
          .describe(`Max results to return (default ${DEFAULT_SEARCH_LIMIT})`),
        excerptsPerRecord: z
          .number()
          .int()
          .min(1)
          .max(MAX_SEARCH_EXCERPTS)
          .optional()
          .describe(`Max excerpts per record (default ${DEFAULT_SEARCH_EXCERPTS})`),
      }),
      execute: async (input) => {
        const searchInput = compactObject({
          ...input,
          limit: input.limit ?? DEFAULT_SEARCH_LIMIT,
          excerptsPerRecord: input.excerptsPerRecord ?? DEFAULT_SEARCH_EXCERPTS,
        }) as FilteredSearchInput
        const result = await filteredSearch(
          searchInput,
          { mode: 'hybrid', maxExcerptChars: MAX_CHUNK_CHARS },
        )
        return {
          hits: result.hits.map((hit) => ({
            recordType: hit.recordType,
            recordId: hit.recordId,
            title: hit.title,
            kind: hit.kind,
            status: hit.status,
            date: hit.date,
            parent: hit.parent,
            sourceSlugs: hit.sourceSlugs,
            externalKinds: hit.externalKinds,
            hasTranscript: hit.hasTranscript,
            score: hit.score,
            lexicalScore: hit.lexicalScore,
            semanticScore: hit.semanticScore,
            snippet: hit.excerpts[0]?.snippet ?? null,
            text: hit.excerpts[0]?.text ?? '',
            excerpts: hit.excerpts.map((excerpt) => ({
              chunkId: excerpt.chunkId,
              chunkIndex: excerpt.chunkIndex,
              snippet: excerpt.snippet,
              text: excerpt.text,
              lexicalScore: excerpt.lexicalScore,
              semanticScore: excerpt.semanticScore,
            })),
          })),
          count: result.count,
          mode: result.mode,
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
