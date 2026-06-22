import { tool } from 'ai'
import { z } from 'zod'
import { retrieve, RETRIEVABLE_SOURCE_KINDS, type SourceRecordType } from '../../retrieval/retrieve'
import { listProjects } from '../../domains/projects/getters'
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

const DEFAULT_SEARCH_LIMIT = 8
const MAX_SEARCH_LIMIT = 20
const DEFAULT_PROJECTS_LIMIT = 30
const MAX_CHUNK_CHARS = 1200
const recordTypeEnum = z.enum([...RETRIEVABLE_SOURCE_KINDS] as [string, ...string[]])
const optionalString = z.string().optional()

function optionalNonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

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
      inputSchema: createTaskSchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('create_task', input),
    }),

    update_task: tool({
      description: writeDescription(
        'Update an existing task by id. Only call this after resolving the task id; ask the user if the target is ambiguous.',
      ),
      inputSchema: updateTaskSchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('update_task', input),
    }),

    complete_task: tool({
      description: writeDescription('Mark an existing task done by id.'),
      inputSchema: completeTaskSchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('complete_task', input),
    }),

    create_person: tool({
      description: writeDescription('Create a person record for a real person the user wants in the brain.'),
      inputSchema: createPersonSchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('create_person', input),
    }),

    update_person: tool({
      description: writeDescription(
        'Update an existing person by id. Only call this after resolving the person id; ask when ambiguous.',
      ),
      inputSchema: updatePersonSchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('update_person', input),
    }),

    create_organization: tool({
      description: writeDescription('Create an organization record for a real company, group, or institution.'),
      inputSchema: createOrganizationSchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('create_organization', input),
    }),

    update_organization: tool({
      description: writeDescription(
        'Update an existing organization by id. Only call this after resolving the organization id; ask when ambiguous.',
      ),
      inputSchema: updateOrganizationSchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('update_organization', input),
    }),

    create_project: tool({
      description: writeDescription(
        'Create a project only when the user explicitly agrees to that project boundary.',
      ),
      inputSchema: createProjectSchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('create_project', input),
    }),

    update_project: tool({
      description: writeDescription(
        'Update an existing project by id. Prefer list_projects to resolve project ids first.',
      ),
      inputSchema: updateProjectSchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('update_project', input),
    }),

    log_interaction: tool({
      description: writeDescription(
        'Create an interaction note for a meeting, call, email, message, or other user-confirmed contact event.',
      ),
      inputSchema: logInteractionSchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('log_interaction', input),
    }),

    remember_fact: tool({
      description: writeDescription(
        'Store a concise durable memory, optionally linked to existing people, organizations, projects, tasks, or interactions.',
      ),
      inputSchema: rememberFactSchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('remember_fact', input),
    }),

    update_memory: tool({
      description: writeDescription(
        'Update an existing memory by id. Use this for correcting the claim, kind, confidence, or validity dates.',
      ),
      inputSchema: updateMemorySchema,
      needsApproval: true,
      execute: (input) => executeChatWriteTool('update_memory', input),
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
