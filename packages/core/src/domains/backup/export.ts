import { sql } from 'kysely'
import { db } from '../../db/client'
import { nowIso } from '../../db/time'

/**
 * JSON export (Plan 08 step 3): a versioned, inspectable dump of the durable
 * records. This is the interchange format; the restorable copy is the SQLite
 * backup. Provider keys are NOT here — they live only in the keychain.
 */

export const EXPORT_VERSION = 1

export interface BrainExport {
  exportVersion: number
  schemaVersion: number
  generatedAt: string
  records: Record<string, unknown[]>
}

async function schemaVersion(): Promise<number> {
  const result = await sql<{ userVersion: number }>`PRAGMA user_version`.execute(db)
  return Number(result.rows[0]?.userVersion ?? 0)
}

/** Assemble the full export object from the durable tables. */
export async function assembleExport(): Promise<BrainExport> {
  const [
    people,
    organizations,
    affiliations,
    projects,
    tasks,
    interactions,
    documents,
    contentChunks,
    memories,
    memoryLinks,
    evidenceRefs,
    tags,
    taggings,
    chatConversations,
    chatMessages,
    settings,
    version,
  ] = await Promise.all([
    db.selectFrom('people').selectAll().execute(),
    db.selectFrom('organizations').selectAll().execute(),
    db.selectFrom('affiliations').selectAll().execute(),
    db.selectFrom('projects').selectAll().execute(),
    db.selectFrom('tasks').selectAll().execute(),
    db.selectFrom('interactions').selectAll().execute(),
    db.selectFrom('documents').selectAll().execute(),
    db.selectFrom('contentChunks').selectAll().execute(),
    db.selectFrom('memories').selectAll().execute(),
    db.selectFrom('memoryLinks').selectAll().execute(),
    db.selectFrom('evidenceRefs').selectAll().execute(),
    db.selectFrom('tags').selectAll().execute(),
    db.selectFrom('taggings').selectAll().execute(),
    db.selectFrom('chatConversations').selectAll().execute(),
    db.selectFrom('chatMessages').selectAll().execute(),
    db.selectFrom('settings').selectAll().execute(),
    schemaVersion(),
  ])

  return {
    exportVersion: EXPORT_VERSION,
    schemaVersion: version,
    generatedAt: nowIso(),
    records: {
      people,
      organizations,
      affiliations,
      projects,
      tasks,
      interactions,
      documents,
      contentChunks,
      memories,
      memoryLinks,
      evidenceRefs,
      tags,
      taggings,
      chatConversations,
      chatMessages,
      settings,
    },
  }
}

/** Counts per table, for a quick "what's in this brain" summary in the UI. */
export function exportCounts(snapshot: BrainExport): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const [table, rows] of Object.entries(snapshot.records)) {
    counts[table] = rows.length
  }
  return counts
}
