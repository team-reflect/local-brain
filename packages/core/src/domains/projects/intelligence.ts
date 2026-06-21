import type { Selectable } from 'kysely'
import type { AiNotes, ExtractedFacts, Memories, Tags } from '@local-brain/db'
import { db } from '../../db/client'

export type ProjectTag = Pick<Selectable<Tags>, 'id' | 'name' | 'slug' | 'color' | 'description'>
export type ProjectExtractedFact = Selectable<ExtractedFacts>
export type ProjectAiNote = Selectable<AiNotes>
export type ProjectMemory = Selectable<Memories>

export interface ProjectIntelligence {
  tags: ProjectTag[]
  memories: ProjectMemory[]
  extractedFacts: ProjectExtractedFact[]
  aiNotes: ProjectAiNote[]
}

/** Tags, hidden memories, extracted facts, and AI notes attached to a project. */
export async function getProjectIntelligence(projectId: string): Promise<ProjectIntelligence> {
  const [tags, memories, extractedFacts, aiNotes] = await Promise.all([
    db
      .selectFrom('tags')
      .innerJoin('taggings', 'taggings.tagId', 'tags.id')
      .where('taggings.recordType', '=', 'project')
      .where('taggings.recordId', '=', projectId)
      .orderBy('tags.name', 'asc')
      .select([
        'tags.id as id',
        'tags.name as name',
        'tags.slug as slug',
        'tags.color as color',
        'tags.description as description',
      ])
      .execute(),
    db
      .selectFrom('memories')
      .innerJoin('memoryLinks', 'memoryLinks.memoryId', 'memories.id')
      .where('memoryLinks.recordType', '=', 'project')
      .where('memoryLinks.recordId', '=', projectId)
      .where('memories.archivedAt', 'is', null)
      .orderBy('memories.createdAt', 'desc')
      .selectAll('memories')
      .execute(),
    db
      .selectFrom('extractedFacts')
      .where('subjectType', '=', 'project')
      .where('subjectId', '=', projectId)
      .where('archivedAt', 'is', null)
      .orderBy('createdAt', 'desc')
      .selectAll()
      .execute(),
    db
      .selectFrom('aiNotes')
      .where('subjectType', '=', 'project')
      .where('subjectId', '=', projectId)
      .orderBy('generatedAt', 'desc')
      .orderBy('createdAt', 'desc')
      .selectAll()
      .execute(),
  ])

  return { tags, memories, extractedFacts, aiNotes }
}
