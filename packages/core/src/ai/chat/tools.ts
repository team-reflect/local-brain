import { tool } from 'ai'
import { z } from 'zod'
import { retrieve } from '../../retrieval/retrieve'
import { listProjects } from '../../domains/projects/getters'

/**
 * Read-only AI SDK tools for Local Brain chat. One module owns tool names,
 * input/output shapes, and the execute implementations so the transport and
 * UI chip only need to import from here.
 *
 * Tools are strictly read-only: no writes to the local database.
 */

const DEFAULT_SEARCH_LIMIT = 8
const MAX_SEARCH_LIMIT = 20
const DEFAULT_PROJECTS_LIMIT = 30
const MAX_CHUNK_CHARS = 1200

export function buildChatTools() {
  return {
    search_records: tool({
      description:
        'Search Local Brain records (documents and interactions) by keyword or topic. ' +
        'Returns relevant text excerpts grounded in local data. ' +
        'Use this to find specific facts, events, promises, or details from documents and meetings.',
      inputSchema: z.object({
        query: z.string().min(1).describe('Search query — plain language or keywords'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_SEARCH_LIMIT)
          .optional()
          .describe(`Max results to return (default ${DEFAULT_SEARCH_LIMIT})`),
      }),
      execute: async ({ query, limit }) => {
        const result = await retrieve(query, { mode: 'hybrid', limit: limit ?? DEFAULT_SEARCH_LIMIT })
        return {
          hits: result.chunks.map((chunk) => ({
            recordType: chunk.recordType,
            recordId: chunk.recordId,
            title: chunk.recordTitle ?? null,
            snippet: chunk.snippet,
            text: chunk.text.length > MAX_CHUNK_CHARS ? chunk.text.slice(0, MAX_CHUNK_CHARS) : chunk.text,
          })),
          count: result.chunks.length,
          semanticAvailable: result.semanticAvailable,
        }
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
