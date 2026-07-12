import type { Compilable } from 'kysely'
import { db } from '../db/client'
import { newId } from '../db/id'
import type { ExtractionResult } from './contracts'
import type { OrganizationCandidate, PersonCandidate, ProjectCandidate } from './match'
import type { ApplySource, EntityType, SourceLinks } from './apply-store'

/**
 * Shared mutable state for one {@link applyExtraction} run, plus the small
 * predicates every entity applier needs (confidence gate, suggestion capture,
 * dependency gate, evidence resolution). The orchestrator builds one context,
 * the per-entity appliers fill its buckets and `resolved` map, and it flushes
 * every insert in FK-dependency order in a single transaction.
 */

export interface Suggestion {
  kind: 'person' | 'organization' | 'project' | 'task' | 'memory'
  ref: string | null
  label: string
  confidence: number | null
}

export interface ApplySummary {
  people: { created: number; matched: number }
  organizations: { created: number; matched: number }
  projects: { created: number; matched: number }
  tasks: { created: number; matched: number }
  affiliations: { created: number }
  memories: { created: number; duplicate: number }
  links: { created: number }
  evidence: { created: number; unresolved: number }
  /** Entities held back below the confidence threshold. */
  suggestions: Suggestion[]
}

export function emptySummary(): ApplySummary {
  return {
    people: { created: 0, matched: 0 },
    organizations: { created: 0, matched: 0 },
    projects: { created: 0, matched: 0 },
    tasks: { created: 0, matched: 0 },
    affiliations: { created: 0 },
    memories: { created: 0, duplicate: 0 },
    links: { created: 0 },
    evidence: { created: 0, unresolved: 0 },
    suggestions: [],
  }
}

/** Pre-apply reads the appliers share (existing rows used for matching/dedupe). */
export interface ApplyCandidates {
  people: PersonCandidate[]
  organizations: OrganizationCandidate[]
  projects: ProjectCandidate[]
}

/** Insert buckets, emitted in FK-dependency order by {@link ApplyContext.statements}. */
interface Buckets {
  people: Compilable[]
  organizations: Compilable[]
  projects: Compilable[]
  tasks: Compilable[]
  affiliations: Compilable[]
  links: Compilable[]
  memories: Compilable[]
  contentChunks: Compilable[]
  memoryLinks: Compilable[]
  evidence: Compilable[]
}

export class ApplyContext {
  readonly summary = emptySummary()
  /** Every extraction ref resolved to an existing-or-new row. */
  readonly resolved = new Map<string, { type: EntityType; id: string }>()
  readonly inserts: Buckets = {
    people: [],
    organizations: [],
    projects: [],
    tasks: [],
    affiliations: [],
    links: [],
    memories: [],
    contentChunks: [],
    memoryLinks: [],
    evidence: [],
  }

  constructor(
    readonly source: ApplySource,
    private readonly minConfidence: number,
    readonly candidates: ApplyCandidates,
    readonly sourceLinks: SourceLinks,
    private readonly chunkMap: Map<number, string>,
  ) {}

  /** Entities at/above the threshold are written; below it they become suggestions. */
  accepts(confidence: number | null | undefined): boolean {
    return confidence == null || confidence >= this.minConfidence
  }

  /** Record a resolved ref so dependents (tasks, memories, links) can find it. */
  resolve(ref: string, type: EntityType, id: string): void {
    this.resolved.set(ref, { type, id })
  }

  /** Hold an entity back below the confidence threshold. */
  suggest(
    kind: Suggestion['kind'],
    ref: string | null | undefined,
    label: string,
    confidence: number | null | undefined,
  ): void {
    this.summary.suggestions.push({ kind, ref: ref ?? null, label, confidence: confidence ?? null })
  }

  /**
   * True when any ref was gated/unresolved, so a dependent record would land
   * partial. Refs are validated to exist in the result, so a ref missing from
   * `resolved` was suppressed below the confidence threshold.
   */
  hasUnresolved(refs: ReadonlyArray<string | null | undefined>): boolean {
    return refs.some((ref) => ref != null && !this.resolved.has(ref))
  }

  /** Attach evidence chunks to a memory/task; unresolved chunk indexes are counted. */
  pushEvidence(
    subjectType: 'memory' | 'task',
    subjectId: string,
    evidence: ExtractionResult['memories'][number]['evidence'],
  ): void {
    for (const ref of evidence) {
      const chunkId = this.chunkMap.get(ref.chunkIndex)
      if (!chunkId) {
        this.summary.evidence.unresolved++
        continue
      }
      this.inserts.evidence.push(
        db.insertInto('evidenceRefs').values({
          id: newId(),
          subjectType,
          subjectId,
          chunkId,
          quoteStart: ref.quoteStart ?? null,
          quoteEnd: ref.quoteEnd ?? null,
          note: ref.note ?? null,
        }),
      )
      this.summary.evidence.created++
    }
  }

  /** Every insert, ordered so foreign keys resolve within the one transaction. */
  statements(): Compilable[] {
    const { inserts } = this
    return [
      ...inserts.people,
      ...inserts.organizations,
      ...inserts.projects,
      ...inserts.tasks,
      ...inserts.affiliations,
      ...inserts.links,
      ...inserts.memories,
      ...inserts.contentChunks,
      ...inserts.memoryLinks,
      ...inserts.evidence,
    ]
  }
}
