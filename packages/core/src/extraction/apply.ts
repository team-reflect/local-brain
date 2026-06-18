import type { Compilable } from 'kysely'
import { db } from '../db/client'
import { batch } from '../db/commands'
import { newId } from '../db/id'
import { recomputeRelationshipIntelligence } from '../domains/relationships/recompute'
import { type ExtractionResult, validateExtraction } from './contracts'
import {
  loadOrganizationCandidates,
  loadPersonCandidates,
  loadProjectCandidates,
  matchOrganization,
  matchPerson,
  matchProject,
  normalizeName,
  type OrganizationCandidate,
  type PersonCandidate,
  type ProjectCandidate,
} from './match'
import {
  loadAffiliationPairs,
  loadChunkMap,
  loadMemoryClaims,
  loadSourceLinks,
  loadTaskCandidates,
  sourceLinkStatement,
  type ApplySource,
  type Resolved,
} from './apply-store'

export type { ApplySource } from './apply-store'

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
 */

export interface ApplyOptions {
  /**
   * Minimum confidence (0-1) for an entity to be *written*. Entities below this
   * (and anything depending on them) become suggestions instead. Entities with
   * no confidence are always written. Default: 0 (write everything).
   */
  minConfidence?: number
}

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

function emptySummary(): ApplySummary {
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

export async function applyExtraction(
  source: ApplySource,
  result: ExtractionResult,
  options: ApplyOptions = {},
): Promise<ApplySummary> {
  const problems = validateExtraction(result)
  if (problems.length > 0) {
    throw new Error(`invalid extraction result: ${problems.join('; ')}`)
  }

  const min = options.minConfidence ?? 0
  const accepts = (confidence: number | null | undefined): boolean =>
    confidence == null || confidence >= min

  const summary = emptySummary()
  const resolved = new Map<string, Resolved>()

  // Statement buckets, emitted in FK-dependency order at the end.
  const peopleInserts: Compilable[] = []
  const orgInserts: Compilable[] = []
  const projectInserts: Compilable[] = []
  const taskInserts: Compilable[] = []
  const affiliationInserts: Compilable[] = []
  const linkInserts: Compilable[] = []
  const memoryInserts: Compilable[] = []
  const memoryLinkInserts: Compilable[] = []
  const evidenceInserts: Compilable[] = []

  const [peopleCandidates, orgCandidates, projectCandidates, sourceLinks, chunkMap] =
    await Promise.all([
      loadPersonCandidates(),
      loadOrganizationCandidates(),
      loadProjectCandidates(),
      loadSourceLinks(source),
      loadChunkMap(source),
    ])

  // ---- People ----------------------------------------------------------
  for (const person of result.people) {
    if (!accepts(person.confidence)) {
      summary.suggestions.push({
        kind: 'person',
        ref: person.ref,
        label: person.fullName,
        confidence: person.confidence ?? null,
      })
      continue
    }
    const matchId = matchPerson(person, peopleCandidates)
    if (matchId) {
      resolved.set(person.ref, { type: 'person', id: matchId })
      summary.people.matched++
      continue
    }
    const id = newId()
    peopleInserts.push(
      db.insertInto('people').values({
        id,
        fullName: person.fullName,
        preferredName: person.preferredName ?? null,
        primaryEmail: person.primaryEmail ?? null,
        primaryPhone: person.primaryPhone ?? null,
        headline: person.headline ?? null,
        location: person.location ?? null,
      }),
    )
    // Make the new row matchable so two refs for the same person collapse.
    const candidate: PersonCandidate = {
      id,
      fullName: person.fullName,
      primaryEmail: person.primaryEmail ?? null,
    }
    peopleCandidates.push(candidate)
    resolved.set(person.ref, { type: 'person', id })
    summary.people.created++
  }

  // ---- Organizations ---------------------------------------------------
  for (const organization of result.organizations) {
    if (!accepts(organization.confidence)) {
      summary.suggestions.push({
        kind: 'organization',
        ref: organization.ref,
        label: organization.name,
        confidence: organization.confidence ?? null,
      })
      continue
    }
    const matchId = matchOrganization(organization, orgCandidates)
    if (matchId) {
      resolved.set(organization.ref, { type: 'organization', id: matchId })
      summary.organizations.matched++
      continue
    }
    const id = newId()
    orgInserts.push(
      db.insertInto('organizations').values({
        id,
        name: organization.name,
        kind: organization.kind ?? null,
        domain: organization.domain ?? null,
        location: organization.location ?? null,
      }),
    )
    const candidate: OrganizationCandidate = {
      id,
      name: organization.name,
      domain: organization.domain ?? null,
    }
    orgCandidates.push(candidate)
    resolved.set(organization.ref, { type: 'organization', id })
    summary.organizations.created++
  }

  // ---- Projects --------------------------------------------------------
  for (const project of result.projects) {
    if (!accepts(project.confidence)) {
      summary.suggestions.push({
        kind: 'project',
        ref: project.ref,
        label: project.name,
        confidence: project.confidence ?? null,
      })
      continue
    }
    const matchId = matchProject(project, projectCandidates)
    if (matchId) {
      resolved.set(project.ref, { type: 'project', id: matchId })
      summary.projects.matched++
      continue
    }
    const id = newId()
    projectInserts.push(
      db.insertInto('projects').values({
        id,
        name: project.name,
        ...(project.status != null ? { status: project.status } : {}),
        kind: project.kind ?? null,
        summary: project.summary ?? null,
        targetDate: project.targetDate ?? null,
      }),
    )
    const candidate: ProjectCandidate = { id, name: project.name }
    projectCandidates.push(candidate)
    resolved.set(project.ref, { type: 'project', id })
    summary.projects.created++
  }

  // ---- Affiliations (person <-> organization) --------------------------
  const existingAffiliations = await loadAffiliationPairs(
    [...resolved.values()].filter((r) => r.type === 'person').map((r) => r.id),
  )
  for (const affiliation of result.affiliations) {
    if (!accepts(affiliation.confidence)) continue
    const person = resolved.get(affiliation.personRef)
    const organization = resolved.get(affiliation.organizationRef)
    if (person?.type !== 'person' || organization?.type !== 'organization') continue
    const pairKey = `${person.id}:${organization.id}`
    if (existingAffiliations.has(pairKey)) continue
    existingAffiliations.add(pairKey)
    affiliationInserts.push(
      db.insertInto('affiliations').values({
        id: newId(),
        personId: person.id,
        organizationId: organization.id,
        title: affiliation.title ?? null,
        role: affiliation.role ?? null,
        isCurrent: affiliation.isCurrent ? 1 : 0,
        startedOn: affiliation.startedOn ?? null,
        endedOn: affiliation.endedOn ?? null,
      }),
    )
    summary.affiliations.created++
  }

  // ---- Tasks -----------------------------------------------------------
  const taskCandidates = await loadTaskCandidates()
  for (const task of result.tasks) {
    if (!accepts(task.confidence)) {
      summary.suggestions.push({
        kind: 'task',
        ref: task.ref,
        label: task.title,
        confidence: task.confidence ?? null,
      })
      continue
    }
    // A task depending on a gated/unresolved entity (its project, people, or
    // organizations) would land partial — with a missing project or dropped
    // links. Hold the whole task back as a suggestion rather than inventing an
    // incomplete one. Refs are validated to exist in the result, so any ref
    // missing from `resolved` was suppressed below the confidence threshold.
    const taskDeps = [
      ...(task.projectRef != null ? [task.projectRef] : []),
      ...task.personRefs,
      ...task.organizationRefs,
    ]
    if (taskDeps.some((dep) => !resolved.has(dep))) {
      summary.suggestions.push({
        kind: 'task',
        ref: task.ref,
        label: task.title,
        confidence: task.confidence ?? null,
      })
      continue
    }
    const projectId =
      task.projectRef != null ? (resolved.get(task.projectRef)?.id ?? null) : null

    const normalizedTitle = normalizeName(task.title)
    const dup = taskCandidates.find((c) => normalizeName(c.title) === normalizedTitle)
    if (dup) {
      // Reuse the existing task: link it to this source and add evidence, but
      // don't mutate its fields or re-add person/org links (correction, 05b).
      resolved.set(task.ref, { type: 'task', id: dup.id })
      summary.tasks.matched++
      pushEvidence(evidenceInserts, summary, chunkMap, 'task', dup.id, task.evidence)
      continue
    }

    const id = newId()
    taskInserts.push(
      db.insertInto('tasks').values({
        id,
        title: task.title,
        description: task.description ?? null,
        ...(task.status != null ? { status: task.status } : {}),
        priority: task.priority ?? null,
        projectId,
        dueAt: task.dueAt ?? null,
        scheduledFor: task.scheduledFor ?? null,
        ...(source.recordType === 'document'
          ? { originDocumentId: source.recordId }
          : { originInteractionId: source.recordId }),
      }),
    )
    taskCandidates.push({ id, title: task.title })
    resolved.set(task.ref, { type: 'task', id })
    summary.tasks.created++

    for (const personRef of task.personRefs) {
      const person = resolved.get(personRef)
      if (person?.type === 'person') {
        linkInserts.push(
          db.insertInto('taskPeople').values({ id: newId(), taskId: id, personId: person.id }),
        )
        summary.links.created++
      }
    }
    for (const organizationRef of task.organizationRefs) {
      const organization = resolved.get(organizationRef)
      if (organization?.type === 'organization') {
        linkInserts.push(
          db
            .insertInto('taskOrganizations')
            .values({ id: newId(), taskId: id, organizationId: organization.id }),
        )
        summary.links.created++
      }
    }
    pushEvidence(evidenceInserts, summary, chunkMap, 'task', id, task.evidence)
  }

  // ---- Link every resolved entity back to the source record ------------
  for (const entity of resolved.values()) {
    const statement = sourceLinkStatement(source, entity.type, entity.id, sourceLinks)
    if (statement) {
      linkInserts.push(statement)
      summary.links.created++
    }
  }

  // ---- Memories --------------------------------------------------------
  const existingClaims = await loadMemoryClaims()
  for (const memory of result.memories) {
    if (!accepts(memory.confidence)) {
      summary.suggestions.push({
        kind: 'memory',
        ref: memory.ref ?? null,
        label: memory.claim,
        confidence: memory.confidence ?? null,
      })
      continue
    }
    // A memory whose subject was gated/unresolved would land without its intended
    // subject — an incomplete fact about no one. Hold it back as a suggestion.
    // Subject refs are validated to exist in the result, so any subject missing
    // from `resolved` was suppressed below the confidence threshold.
    if (memory.subjects.some((subject) => !resolved.has(subject.ref))) {
      summary.suggestions.push({
        kind: 'memory',
        ref: memory.ref ?? null,
        label: memory.claim,
        confidence: memory.confidence ?? null,
      })
      continue
    }
    const claimKey = memory.claim.trim().toLowerCase()
    if (existingClaims.has(claimKey)) {
      summary.memories.duplicate++
      continue
    }
    existingClaims.add(claimKey)

    const id = newId()
    memoryInserts.push(
      db.insertInto('memories').values({
        id,
        kind: memory.kind,
        claim: memory.claim,
        confidence: memory.confidence ?? null,
        validFrom: memory.validFrom ?? null,
        validTo: memory.validTo ?? null,
      }),
    )
    summary.memories.created++

    // Always link the memory to its source record.
    memoryLinkInserts.push(
      db.insertInto('memoryLinks').values({
        id: newId(),
        memoryId: id,
        recordType: source.recordType,
        recordId: source.recordId,
        role: 'source',
      }),
    )
    summary.links.created++

    const linkedRecords = new Set<string>([`${source.recordType}:${source.recordId}`])
    for (const subject of memory.subjects) {
      const target = resolved.get(subject.ref)
      if (!target) continue
      const dedupeKey = `${target.type}:${target.id}`
      if (linkedRecords.has(dedupeKey)) continue
      linkedRecords.add(dedupeKey)
      memoryLinkInserts.push(
        db.insertInto('memoryLinks').values({
          id: newId(),
          memoryId: id,
          recordType: target.type,
          recordId: target.id,
          role: subject.role ?? null,
        }),
      )
      summary.links.created++
    }
    pushEvidence(evidenceInserts, summary, chunkMap, 'memory', id, memory.evidence)
  }

  const statements = [
    ...peopleInserts,
    ...orgInserts,
    ...projectInserts,
    ...taskInserts,
    ...affiliationInserts,
    ...linkInserts,
    ...memoryInserts,
    ...memoryLinkInserts,
    ...evidenceInserts,
  ]

  if (statements.length > 0) {
    await batch(statements)
  }

  // Linking people to an interaction is a "relevant interaction" — refresh their
  // relationship hints (Plan 05 step 9) after the apply transaction commits.
  if (source.recordType === 'interaction') {
    for (const entity of resolved.values()) {
      if (entity.type === 'person') {
        await recomputeRelationshipIntelligence(entity.id)
      }
    }
  }
  return summary
}

function pushEvidence(
  bucket: Compilable[],
  summary: ApplySummary,
  chunkMap: Map<number, string>,
  subjectType: 'memory' | 'task',
  subjectId: string,
  evidence: ExtractionResult['memories'][number]['evidence'],
): void {
  for (const ref of evidence) {
    const chunkId = chunkMap.get(ref.chunkIndex)
    if (!chunkId) {
      summary.evidence.unresolved++
      continue
    }
    bucket.push(
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
    summary.evidence.created++
  }
}
