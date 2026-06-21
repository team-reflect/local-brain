import { db } from '../../db/client'

/** A record cited as evidence for a suggestion, resolved to a display title. */
export interface SuggestionLink {
  recordType: string
  recordId: string
  title: string
}

/** The proposed-entity fields persisted in `suggestions.payload_json`. */
export interface SuggestionPayload {
  name?: string | null
  summary?: string | null
  domain?: string | null
  kind?: string | null
}

/** An open curation proposal (a project/organization the importer didn't create).
 * Named `CurationSuggestion` to avoid colliding with the extraction pipeline's
 * unrelated `Suggestion` (a proposed memory). */
export interface CurationSuggestion {
  id: string
  /** `create_project` | `create_organization` */
  kind: string
  title: string
  rationale: string | null
  status: string
  payload: SuggestionPayload | null
  links: SuggestionLink[]
  createdAt: string
}

function parsePayload(raw: string | null): SuggestionPayload | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as SuggestionPayload
  } catch {
    return null
  }
}

/** Resolve a cited `{recordType, recordId}` to a human title for the card. */
async function resolveLinkTitle(recordType: string, recordId: string): Promise<string> {
  const untitled = '(untitled)'
  switch (recordType) {
    case 'person': {
      const row = await db
        .selectFrom('people')
        .select('fullName as title')
        .where('id', '=', recordId)
        .executeTakeFirst()
      return row?.title ?? untitled
    }
    case 'organization': {
      const row = await db
        .selectFrom('organizations')
        .select('name as title')
        .where('id', '=', recordId)
        .executeTakeFirst()
      return row?.title ?? untitled
    }
    case 'project': {
      const row = await db
        .selectFrom('projects')
        .select('name as title')
        .where('id', '=', recordId)
        .executeTakeFirst()
      return row?.title ?? untitled
    }
    case 'task': {
      const row = await db
        .selectFrom('tasks')
        .select('title as title')
        .where('id', '=', recordId)
        .executeTakeFirst()
      return row?.title ?? untitled
    }
    case 'document': {
      const row = await db
        .selectFrom('documents')
        .select('title as title')
        .where('id', '=', recordId)
        .executeTakeFirst()
      return row?.title ?? untitled
    }
    case 'interaction': {
      const row = await db
        .selectFrom('interactions')
        .select('title as title')
        .where('id', '=', recordId)
        .executeTakeFirst()
      return row?.title ?? untitled
    }
    default:
      return untitled
  }
}

/**
 * Open suggestions, newest first, each with its evidence links resolved to
 * titles. Read-only; the desktop surfaces these for the user to accept/dismiss.
 */
export async function listOpenSuggestions(): Promise<CurationSuggestion[]> {
  const rows = await db
    .selectFrom('suggestions')
    .select(['id', 'kind', 'title', 'rationale', 'status', 'payloadJson', 'createdAt'])
    .where('status', '=', 'open')
    .orderBy('createdAt', 'desc')
    .execute()

  return Promise.all(
    rows.map(async (row) => {
      const linkRows = await db
        .selectFrom('suggestionLinks')
        .select(['recordType', 'recordId'])
        .where('suggestionId', '=', row.id)
        .orderBy('createdAt', 'asc')
        .execute()
      const links = await Promise.all(
        linkRows.map(async (link) => ({
          recordType: link.recordType,
          recordId: link.recordId,
          title: await resolveLinkTitle(link.recordType, link.recordId),
        })),
      )
      return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        rationale: row.rationale,
        status: row.status,
        payload: parsePayload(row.payloadJson),
        links,
        createdAt: row.createdAt,
      }
    }),
  )
}
