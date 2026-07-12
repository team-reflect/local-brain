import { sql } from 'kysely'
import { db } from '../../db/client'
import { listProjects, type Project } from '../../domains/projects/getters'
import type { SourceRecordType } from '../../retrieval/retrieve'

const MAX_INTERACTION_KINDS = 12
const MAX_TAGS = 20
const MAX_ACTIVE_PROJECTS = 30

/** Counted database vocabulary value supplied to Chat for tool planning. */
export interface ChatBrainFacet {
  value: string
  count: number
}

/** Counted tag vocabulary value with its optional canonical slug. */
export interface ChatBrainTag extends ChatBrainFacet {
  slug: string | null
}

/** Bounded identity summary for the brain's unarchived self person. */
export interface ChatBrainSelf {
  recordId: string
  name: string
  preferredName: string | null
  headline: string | null
}

/** Compact, bounded database context supplied to Chat once per user turn. */
export interface ChatBrainOverview {
  recordCounts: Partial<Record<SourceRecordType, number>>
  earliestRecordDate: string | null
  latestRecordDate: string | null
  interactionKinds: ChatBrainFacet[]
  interactionKindsTruncated: boolean
  tags: ChatBrainTag[]
  tagsTruncated: boolean
  self: ChatBrainSelf | null
  activeProjects: Project[]
}

interface RecordCountRow {
  recordType: SourceRecordType
  count: number
  earliestDate: string | null
  latestDate: string | null
}

interface FacetRow {
  value: string
  count: number
}

interface TagRow extends FacetRow {
  slug: string | null
}

interface SelfRow {
  recordId: string
  name: string
  preferredName: string | null
  headline: string | null
}

function numeric(value: number): number {
  return Number(value)
}

async function recordCounts(): Promise<RecordCountRow[]> {
  return (
    await sql<RecordCountRow>`
      WITH records(record_type, record_id, record_date) AS (
        SELECT 'person', id, COALESCE(last_interaction_at, updated_at)
        FROM people WHERE archived_at IS NULL
        UNION ALL
        SELECT 'organization', id, updated_at
        FROM organizations WHERE archived_at IS NULL
        UNION ALL
        SELECT 'organization_profile', profiles.id, COALESCE(profiles.researched_at, profiles.updated_at)
        FROM organization_profiles profiles
        JOIN organizations ON organizations.id = profiles.organization_id
        WHERE organizations.archived_at IS NULL
        UNION ALL
        SELECT 'project', id, COALESCE(target_date, updated_at)
        FROM projects WHERE archived_at IS NULL
        UNION ALL
        SELECT 'task', id, COALESCE(due_at, scheduled_for, updated_at)
        FROM tasks WHERE archived_at IS NULL
        UNION ALL
        SELECT 'document', id, COALESCE(occurred_at, authored_at, updated_at)
        FROM documents WHERE archived_at IS NULL
        UNION ALL
        SELECT 'interaction', id, COALESCE(occurred_at, updated_at)
        FROM interactions WHERE archived_at IS NULL
        UNION ALL
        SELECT 'interaction_transcript', transcripts.id,
               COALESCE(interactions.occurred_at, transcripts.transcribed_at, transcripts.updated_at)
        FROM interaction_transcripts transcripts
        JOIN interactions ON interactions.id = transcripts.interaction_id
        WHERE interactions.archived_at IS NULL
        UNION ALL
        SELECT 'ai_note', id, COALESCE(generated_at, updated_at)
        FROM ai_notes
        UNION ALL
        SELECT 'extracted_fact', id, COALESCE(observed_at, updated_at)
        FROM extracted_facts WHERE archived_at IS NULL
        UNION ALL
        SELECT 'memory', id, COALESCE(valid_from, updated_at)
        FROM memories WHERE archived_at IS NULL
        UNION ALL
        SELECT 'asset', id, updated_at
        FROM assets WHERE archived_at IS NULL
      )
      SELECT
        record_type AS "recordType",
        COUNT(*) AS "count",
        MIN(record_date) AS "earliestDate",
        MAX(record_date) AS "latestDate"
      FROM records
      GROUP BY record_type
      ORDER BY record_type
    `.execute(db)
  ).rows
}

async function interactionKinds(): Promise<FacetRow[]> {
  return (
    await sql<FacetRow>`
      SELECT kind AS "value", COUNT(*) AS "count"
      FROM interactions
      WHERE archived_at IS NULL AND trim(kind) <> ''
      GROUP BY kind
      ORDER BY COUNT(*) DESC, kind ASC
      LIMIT ${MAX_INTERACTION_KINDS + 1}
    `.execute(db)
  ).rows
}

async function usedTags(): Promise<TagRow[]> {
  return (
    await sql<TagRow>`
      SELECT
        tags.name AS "value",
        tags.slug AS "slug",
        COUNT(DISTINCT taggings.record_type || ':' || taggings.record_id) AS "count"
      FROM tags
      JOIN taggings ON taggings.tag_id = tags.id
      GROUP BY tags.id, tags.name, tags.slug
      ORDER BY COUNT(DISTINCT taggings.record_type || ':' || taggings.record_id) DESC,
               lower(tags.name) ASC
      LIMIT ${MAX_TAGS + 1}
    `.execute(db)
  ).rows
}

async function selfSummary(): Promise<SelfRow | null> {
  return (
    (await db
      .selectFrom('people')
      .select([
        'id as recordId',
        'fullName as name',
        'preferredName',
        'headline',
      ])
      .where('isSelf', '=', 1)
      .where('archivedAt', 'is', null)
      .limit(1)
      .executeTakeFirst()) ?? null
  )
}

/** Load the bounded private-brain vocabulary needed to plan grounded tool calls. */
export async function loadChatBrainOverview(): Promise<ChatBrainOverview> {
  const [records, kinds, tags, self, activeProjects] = await Promise.all([
    recordCounts(),
    interactionKinds(),
    usedTags(),
    selfSummary(),
    listProjects({ activeOnly: true, limit: MAX_ACTIVE_PROJECTS }),
  ])

  const counts: Partial<Record<SourceRecordType, number>> = {}
  const dates: string[] = []
  for (const row of records) {
    counts[row.recordType] = numeric(row.count)
    if (row.earliestDate) dates.push(row.earliestDate)
    if (row.latestDate) dates.push(row.latestDate)
  }
  dates.sort()

  return {
    recordCounts: counts,
    earliestRecordDate: dates.at(0) ?? null,
    latestRecordDate: dates.at(-1) ?? null,
    interactionKinds: kinds.slice(0, MAX_INTERACTION_KINDS).map((row) => ({
      value: row.value,
      count: numeric(row.count),
    })),
    interactionKindsTruncated: kinds.length > MAX_INTERACTION_KINDS,
    tags: tags.slice(0, MAX_TAGS).map((row) => ({
      value: row.value,
      slug: row.slug,
      count: numeric(row.count),
    })),
    tagsTruncated: tags.length > MAX_TAGS,
    self,
    activeProjects,
  }
}
