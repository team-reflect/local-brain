import { batch } from '../db/commands'
import { activeDatabaseIdentity, assertActiveDatabaseIdentity } from '../db/identity'
import { recomputeRelationshipIntelligence } from '../domains/relationships/recompute'
import { type ExtractionResult, validateExtraction } from './contracts'
import {
  loadOrganizationCandidates,
  loadPersonCandidates,
  loadProjectCandidates,
} from './match'
import { loadChunkMap, loadSourceLinks, sourceLinkStatement, type ApplySource } from './apply-store'
import { ApplyContext, type ApplySummary } from './apply-context'
import { applyAffiliations, applyOrganizations, applyPeople, applyProjects } from './apply-entities'
import { applyTasks } from './apply-tasks'
import { applyMemories } from './apply-memories'

export type { ApplySource } from './apply-store'
export type { ApplySummary, Suggestion } from './apply-context'

/**
 * Apply a validated {@link ExtractionResult} to the canonical store (Plan 05
 * steps 4-7, the deterministic half).
 *
 * This is the merge engine that sits *after* the model: given a typed result, it
 * resolves every entity ref to an existing-or-new row (merge/upsert), writes new
 * people / organizations / projects / tasks / affiliations, links them all back
 * to the source record, creates hidden memories with their `memory_links`, and
 * attaches `evidence_refs` to the originating chunks — all in **one** Rust
 * transaction so an extraction never lands half-applied. It does no model work
 * and invents nothing: low-confidence entities become suggestions (not writes),
 * obvious duplicates are skipped, and unresolved evidence/links are reported
 * rather than guessed.
 *
 * The orchestration here is deliberately small: a shared {@link ApplyContext}
 * holds the mutable buckets/summary/resolved map, and each per-entity applier
 * (see `apply-entities`, `apply-tasks`, `apply-memories`) fills it. Order matters
 * — affiliations need resolved people/orgs, tasks need resolved projects/people/
 * orgs, source links need every entity, and memories need all of the above.
 */

export interface ApplyOptions {
  /**
   * Minimum confidence (0-1) for an entity to be *written*. Entities below this
   * (and anything depending on them) become suggestions instead. Entities with
   * no confidence are always written. Default: 0 (write everything).
   */
  minConfidence?: number
}

export async function applyExtraction(
  source: ApplySource,
  result: ExtractionResult,
  options: ApplyOptions = {},
): Promise<ApplySummary> {
  const databaseIdentity = await activeDatabaseIdentity()
  const problems = validateExtraction(result)
  if (problems.length > 0) {
    throw new Error(`invalid extraction result: ${problems.join('; ')}`)
  }

  const [people, organizations, projects, sourceLinks, chunkMap] = await Promise.all([
    loadPersonCandidates(databaseIdentity),
    loadOrganizationCandidates(databaseIdentity),
    loadProjectCandidates(databaseIdentity),
    loadSourceLinks(source, databaseIdentity),
    loadChunkMap(source, databaseIdentity),
  ])

  const ctx = new ApplyContext(
    source,
    options.minConfidence ?? 0,
    { people, organizations, projects },
    sourceLinks,
    chunkMap,
  )

  // Resolve the network entities (refs → rows) before anything depends on them.
  applyPeople(ctx, result.people)
  applyOrganizations(ctx, result.organizations)
  applyProjects(ctx, result.projects)
  await applyAffiliations(ctx, result.affiliations, databaseIdentity)
  await applyTasks(ctx, result.tasks, databaseIdentity)

  // Link every resolved entity back to the source record, then the memories that
  // reference them.
  for (const entity of ctx.resolved.values()) {
    const statement = sourceLinkStatement(source, entity.type, entity.id, ctx.sourceLinks)
    if (statement) {
      ctx.inserts.links.push(statement)
      ctx.summary.links.created++
    }
  }
  await applyMemories(ctx, result.memories, databaseIdentity)

  const statements = ctx.statements()
  if (statements.length > 0) {
    await batch(statements, databaseIdentity)
  }

  // Linking people to an interaction is a "relevant interaction" — refresh their
  // relationship hints (Plan 05 step 9) after the apply transaction commits.
  if (source.recordType === 'interaction') {
    for (const entity of ctx.resolved.values()) {
      if (entity.type === 'person') {
        await recomputeRelationshipIntelligence(entity.id, { databaseIdentity })
      }
    }
  }
  // A fully duplicate/gated extraction can have no guarded write. Recheck the
  // captured brain before exposing even that derived no-op summary.
  await assertActiveDatabaseIdentity(databaseIdentity)
  return ctx.summary
}
