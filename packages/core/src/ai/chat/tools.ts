import { tool } from 'ai'
import { z } from 'zod'
import {
  assertActiveDatabaseIdentity,
  type DatabaseIdentity,
} from '../../db/identity'
import { searchRecordCandidates } from '../../retrieval/record-candidates'
import type { RelatedRecordRef } from '../../retrieval/related-records'
import { RETRIEVABLE_SOURCE_KINDS, type SourceRecordType } from '../../retrieval/retrieve'
import { listProjects } from '../../domains/projects/getters'
import {
  DEFAULT_RECORD_DETAIL_CHARS,
  DEFAULT_RECORD_DETAIL_TOTAL_CHARS,
  MAX_RECORD_DETAIL_CHARS,
  MAX_RECORD_DETAIL_TOTAL_CHARS,
  getChatRecords,
  type ChatRecordRequest,
} from './record-details'
import { listChatTasks } from './task-browser'
import {
  completeTaskSchema,
  createOrganizationSchema,
  createPersonSchema,
  createProjectSchema,
  createTaskSchema,
  executeChatWriteTool,
  logInteractionSchema,
  rememberFactSchema,
  updateMemorySchema,
  updateOrganizationSchema,
  updatePersonSchema,
  updateProjectSchema,
  updateTaskSchema,
} from './write-tools'
export {
  CHAT_WRITE_TOOL_NAMES,
  executeChatWriteTool,
  isChatWriteToolName,
  type ChatWriteToolName,
  type ChatWriteToolOutput,
} from './write-tools'

/**
 * AI SDK tools for Local Brain chat. One module owns tool names,
 * input/output shapes, and the execute implementations so the transport and
 * UI chip only need to import from here.
 *
 * Write tools are approval-gated with `needsApproval: true`; the UI must collect
 * an explicit Approve response before the execute function mutates SQLite.
 */

const DEFAULT_SEARCH_LIMIT = 20
const MAX_SEARCH_LIMIT = 50
const MAX_GET_RECORDS = 10
const MAX_RECORD_CHUNK_IDS = 5
const DEFAULT_PROJECTS_LIMIT = 30
const DEFAULT_TASKS_LIMIT = 30
const recordTypeEnum = z.enum([...RETRIEVABLE_SOURCE_KINDS] as [string, ...string[]])
const optionalString = z.string().optional()
const relatedRecordTypeEnum = z.enum([
  'person',
  'organization',
  'project',
  'task',
  'document',
  'interaction',
])
const relatedRecordSchema = z.object({
  recordType: relatedRecordTypeEnum,
  recordId: z.string().min(1),
})
const recordLookupSchema = z.object({
  recordType: recordTypeEnum,
  recordId: z.string().min(1),
  chunkIds: z.array(z.string().min(1)).max(MAX_RECORD_CHUNK_IDS).optional(),
})

function optionalNonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function writeDescription(action: string): string {
  return `${action} Requires explicit user approval before it changes Local Brain.`
}

async function guardedRead<T>(
  identity: DatabaseIdentity | undefined,
  read: () => Promise<T>,
): Promise<T> {
  if (identity) await assertActiveDatabaseIdentity(identity)
  const result = await read()
  if (identity) await assertActiveDatabaseIdentity(identity)
  return result
}

export interface BuildChatToolsOptions {
  /** Bind every tool read/write in this model turn to one open brain. */
  databaseIdentity?: DatabaseIdentity
}

/** Build the bounded read/write tool set for one optionally brain-pinned Chat turn. */
export function buildChatTools(options: BuildChatToolsOptions = {}) {
  const identity = options.databaseIdentity
  return {
    search_records: tool({
      description:
        'Search Local Brain records by topic, names, or keywords. Meaning-based recall is added when local embeddings are ready; lexical search remains available otherwise. ' +
        'Use one broad query and raise limit to widen recall; use filters when the topic must be scoped to a person, project, record type, interaction kind, or date. The output reports whether semantic results contributed.',
      inputSchema: z.object({
        query: z.string().trim().min(1).describe('One broad topic, name, phrase, or keyword query.'),
        recordTypes: z
          .array(recordTypeEnum)
          .optional()
          .describe('Optional record types to search.'),
        kinds: z
          .array(z.string())
          .max(12)
          .optional()
          .describe('Optional interaction kinds from the brain overview, such as email, meeting, or call.'),
        after: optionalString.describe('Only records on/after this ISO 8601 date.'),
        before: optionalString.describe('Only records on/before this ISO 8601 (UTC) date.'),
        relatedTo: z
          .array(relatedRecordSchema)
          .max(5)
          .optional()
          .describe(
            'Restrict to records related to these exact Local Brain ids. Resolve ids with search_records first. Multiple refs are intersected.',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_SEARCH_LIMIT)
          .optional()
          .describe(`Max results to return (default ${DEFAULT_SEARCH_LIMIT})`),
      }),
      execute: async ({ query, recordTypes, kinds, after, before, relatedTo, limit }) => {
        const afterValue = optionalNonBlank(after)
        const beforeValue = optionalNonBlank(before)
        const result = await guardedRead(identity, () =>
          searchRecordCandidates(query, {
            mode: 'hybrid',
            sort: 'relevance',
            limit: limit ?? DEFAULT_SEARCH_LIMIT,
            ...(recordTypes && recordTypes.length > 0
              ? { recordTypes: recordTypes as SourceRecordType[] }
              : {}),
            ...(kinds && kinds.length > 0 ? { kinds } : {}),
            ...(afterValue ? { after: afterValue } : {}),
            ...(beforeValue ? { before: beforeValue } : {}),
            ...(relatedTo && relatedTo.length > 0
              ? { relatedTo: relatedTo as RelatedRecordRef[] }
              : {}),
          }),
        )
        return {
          records: result.candidates,
          count: result.candidates.length,
          semanticAvailable: result.semanticAvailable,
        }
      },
    }),

    browse_records: tool({
      description:
        'Browse Local Brain records by recency, date, type, interaction kind, or relationship without a topic query. ' +
        'Use this for recent activity, date ranges, or records connected to a known person/project/task.',
      inputSchema: z.object({
        recordTypes: z.array(recordTypeEnum).optional().describe('Record types to browse.'),
        kinds: z
          .array(z.string())
          .max(12)
          .optional()
          .describe('Interaction kinds from the brain overview, such as email, meeting, or call.'),
        after: optionalString.describe('Only records on/after this ISO 8601 date.'),
        before: optionalString.describe('Only records on/before this ISO 8601 date.'),
        relatedTo: z
          .array(relatedRecordSchema)
          .max(5)
          .optional()
          .describe('Only records related to these exact Local Brain record ids.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_SEARCH_LIMIT)
          .optional()
          .describe(`Max records to return (default ${DEFAULT_SEARCH_LIMIT})`),
      }),
      execute: async ({ recordTypes, kinds, after, before, relatedTo, limit }) => {
        const afterValue = optionalNonBlank(after)
        const beforeValue = optionalNonBlank(before)
        const hasFilter =
          (recordTypes?.length ?? 0) > 0 ||
          (kinds?.length ?? 0) > 0 ||
          Boolean(afterValue) ||
          Boolean(beforeValue) ||
          (relatedTo?.length ?? 0) > 0
        if (!hasFilter) {
          throw new Error(
            'Choose at least one browse filter: recordTypes, kinds, after, before, or relatedTo.',
          )
        }
        const result = await guardedRead(identity, () =>
          searchRecordCandidates('', {
            mode: 'hybrid',
            sort: 'recency',
            limit: limit ?? DEFAULT_SEARCH_LIMIT,
            ...(recordTypes && recordTypes.length > 0
              ? { recordTypes: recordTypes as SourceRecordType[] }
              : {}),
            ...(kinds && kinds.length > 0 ? { kinds } : {}),
            ...(afterValue ? { after: afterValue } : {}),
            ...(beforeValue ? { before: beforeValue } : {}),
            ...(relatedTo && relatedTo.length > 0
              ? { relatedTo: relatedTo as RelatedRecordRef[] }
              : {}),
          }),
        )
        return {
          records: result.candidates,
          count: result.candidates.length,
          semanticAvailable: result.semanticAvailable,
        }
      },
    }),

    get_records: tool({
      description:
        'Load structured details and bounded grounding chunks for specific Local Brain records found by search_records. ' +
        'Use this after search_records when a question needs details from promising hits. Pass recordType and recordId, ' +
        'and include chunkIds from search_records to focus the returned context around matched chunks.',
      inputSchema: z.object({
        records: z
          .array(recordLookupSchema)
          .min(1)
          .max(MAX_GET_RECORDS)
          .describe('Records to load, usually chosen from search_records hits.'),
        maxCharsPerRecord: z
          .number()
          .int()
          .min(1)
          .max(MAX_RECORD_DETAIL_CHARS)
          .optional()
          .describe(`Max chunk text characters per record (default ${DEFAULT_RECORD_DETAIL_CHARS})`),
        maxTotalChars: z
          .number()
          .int()
          .min(1000)
          .max(MAX_RECORD_DETAIL_TOTAL_CHARS)
          .optional()
          .describe(`Total chunk text budget for this batched call (default ${DEFAULT_RECORD_DETAIL_TOTAL_CHARS})`),
      }),
      execute: async ({ records, maxCharsPerRecord, maxTotalChars }) => {
        const requests: ChatRecordRequest[] = records.map((record) => ({
          recordType: record.recordType as SourceRecordType,
          recordId: record.recordId,
          ...(record.chunkIds !== undefined ? { chunkIds: record.chunkIds } : {}),
        }))
        const details = await guardedRead(identity, () =>
          getChatRecords(requests, {
            ...(maxCharsPerRecord === undefined ? {} : { maxCharsPerRecord }),
            ...(maxTotalChars === undefined ? {} : { maxTotalChars }),
          }),
        )
        return {
          records: details,
          count: details.length,
        }
      },
    }),

    list_tasks: tool({
      description:
        'Browse structured Local Brain tasks by status, due date, project, or related person. ' +
        'Use this instead of topic search for task lists, deadlines, waiting items, and overdue work.',
      inputSchema: z.object({
        statuses: z.array(z.string()).max(8).optional().describe('Exact task statuses to include.'),
        projectId: optionalString.describe('Only tasks in this exact project id.'),
        personId: optionalString.describe('Only tasks linked to this exact person id.'),
        dueAfter: optionalString.describe('Only tasks due/scheduled on or after this ISO 8601 date.'),
        dueBefore: optionalString.describe('Only tasks due/scheduled on or before this ISO 8601 date.'),
        includeCompleted: z
          .boolean()
          .optional()
          .describe('Include terminal tasks when statuses are omitted (default false).'),
        sort: z
          .enum(['due', 'recently_updated'])
          .optional()
          .describe('Sort by due date (default) or most recently updated.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe(`Max tasks to return (default ${DEFAULT_TASKS_LIMIT})`),
      }),
      execute: async ({
        statuses,
        projectId,
        personId,
        dueAfter,
        dueBefore,
        includeCompleted,
        sort,
        limit,
      }) => {
        const projectIdValue = optionalNonBlank(projectId)
        const personIdValue = optionalNonBlank(personId)
        const dueAfterValue = optionalNonBlank(dueAfter)
        const dueBeforeValue = optionalNonBlank(dueBefore)
        const records = await guardedRead(identity, () =>
          listChatTasks({
            ...(statuses && statuses.length > 0 ? { statuses } : {}),
            ...(projectIdValue ? { projectId: projectIdValue } : {}),
            ...(personIdValue ? { personId: personIdValue } : {}),
            ...(dueAfterValue ? { dueAfter: dueAfterValue } : {}),
            ...(dueBeforeValue ? { dueBefore: dueBeforeValue } : {}),
            ...(includeCompleted === undefined ? {} : { includeCompleted }),
            ...(sort === undefined ? {} : { sort }),
            limit: limit ?? DEFAULT_TASKS_LIMIT,
          }),
        )
        return { records, count: records.length }
      },
    }),

    create_task: tool({
      description: writeDescription(
        'Create a task after the user asks to track a concrete follow-up or action item.',
      ),
      inputSchema: createTaskSchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('create_task', input, identity),
    }),

    update_task: tool({
      description: writeDescription(
        'Update an existing task by id. Only call this after resolving the task id; ask the user if the target is ambiguous.',
      ),
      inputSchema: updateTaskSchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('update_task', input, identity),
    }),

    complete_task: tool({
      description: writeDescription('Mark an existing task done by id.'),
      inputSchema: completeTaskSchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('complete_task', input, identity),
    }),

    create_person: tool({
      description: writeDescription('Create a person record for a real person the user wants in the brain.'),
      inputSchema: createPersonSchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('create_person', input, identity),
    }),

    update_person: tool({
      description: writeDescription(
        'Update an existing person by id. Only call this after resolving the person id; ask when ambiguous.',
      ),
      inputSchema: updatePersonSchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('update_person', input, identity),
    }),

    create_organization: tool({
      description: writeDescription('Create an organization record for a real company, group, or institution.'),
      inputSchema: createOrganizationSchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('create_organization', input, identity),
    }),

    update_organization: tool({
      description: writeDescription(
        'Update an existing organization by id. Only call this after resolving the organization id; ask when ambiguous.',
      ),
      inputSchema: updateOrganizationSchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('update_organization', input, identity),
    }),

    create_project: tool({
      description: writeDescription(
        'Create a project only when the user explicitly agrees to that project boundary.',
      ),
      inputSchema: createProjectSchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('create_project', input, identity),
    }),

    update_project: tool({
      description: writeDescription(
        'Update an existing project by id. Prefer list_projects to resolve project ids first.',
      ),
      inputSchema: updateProjectSchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('update_project', input, identity),
    }),

    log_interaction: tool({
      description: writeDescription(
        'Create an interaction note for a meeting, call, email, message, or other user-confirmed contact event.',
      ),
      inputSchema: logInteractionSchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('log_interaction', input, identity),
    }),

    remember_fact: tool({
      description: writeDescription(
        'Store a concise durable memory, optionally linked to existing people, organizations, projects, tasks, or interactions.',
      ),
      inputSchema: rememberFactSchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('remember_fact', input, identity),
    }),

    update_memory: tool({
      description: writeDescription(
        'Update an existing memory by id. Use this for correcting the claim, kind, confidence, or validity dates.',
      ),
      inputSchema: updateMemorySchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('update_memory', input, identity),
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
        const projects = await guardedRead(identity, () =>
          listProjects({
            ...(status !== undefined ? { status } : { activeOnly: true }),
            limit: limit ?? DEFAULT_PROJECTS_LIMIT,
          }),
        )
        return {
          records: projects.map((p) => ({
            recordType: 'project' as const,
            recordId: p.id,
            recordRef: `project:${p.id}`,
            title: p.name,
            name: p.name,
            date: p.targetDate ?? p.updatedAt,
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
