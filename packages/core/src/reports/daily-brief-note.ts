import type { Selectable } from 'kysely'
import type { AiNotes } from '@local-brain/db'
import { db } from '../db/client'
import { batch } from '../db/commands'
import { newId } from '../db/id'
import { nowIso } from '../db/time'
import { chunkText, normalizeText } from '../ingest/chunk'
import { contentHash } from '../ingest/hash'

export const DAILY_BRIEF_NOTE_KIND = 'daily_brief'
export const DAILY_BRIEF_SUBJECT_TYPE = 'daily_brief'

export type DailyBriefNote = Selectable<AiNotes>

export interface SaveDailyBriefNoteInput {
  date: string
  title?: string | null
  content: string
  model: string | null
  promptFingerprint?: string | null
  metadata?: Record<string, unknown> | null
  generatedAt?: string
}

export function latestDailyBriefNote(date: string): Promise<DailyBriefNote | undefined> {
  return db
    .selectFrom('aiNotes')
    .selectAll()
    .where('kind', '=', DAILY_BRIEF_NOTE_KIND)
    .where('subjectType', '=', DAILY_BRIEF_SUBJECT_TYPE)
    .where('subjectId', '=', date)
    .orderBy('generatedAt', 'desc')
    .orderBy('createdAt', 'desc')
    .executeTakeFirst()
}

/** Persist a generated Today brief as an AI note and index chunks for retrieval/search. */
export async function saveDailyBriefNote(input: SaveDailyBriefNoteInput): Promise<string> {
  const id = newId()
  const generatedAt = input.generatedAt ?? nowIso()
  const content = normalizeText(input.content)
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null
  const chunks = await Promise.all(
    chunkText(content).map(async (chunk) => ({
      ...chunk,
      id: newId(),
      hash: await contentHash(chunk.text),
    })),
  )

  await batch([
    db.insertInto('aiNotes').values({
      id,
      kind: DAILY_BRIEF_NOTE_KIND,
      subjectType: DAILY_BRIEF_SUBJECT_TYPE,
      subjectId: input.date,
      title: input.title ?? `Daily brief - ${input.date}`,
      content,
      contentFormat: 'markdown',
      model: input.model,
      promptFingerprint: input.promptFingerprint ?? null,
      metadataJson,
      generatedAt,
    }),
    ...chunks.map((chunk) =>
      db.insertInto('contentChunks').values({
        id: chunk.id,
        recordType: 'ai_note',
        recordId: id,
        chunkIndex: chunk.index,
        text: chunk.text,
        contentHash: chunk.hash,
        citationLabel: `Daily brief ${input.date}`,
      }),
    ),
  ])

  return id
}
