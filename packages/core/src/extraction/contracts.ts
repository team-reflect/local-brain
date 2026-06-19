import { z } from 'zod'

/**
 * Extraction output contracts (Plan 05 step 1).
 *
 * These types define the *exact shape a model must produce* when it extracts
 * structured context from a document or interaction. They are the typed boundary
 * between model output and Local Brain's canonical SQLite store: an extractor (a
 * BYOK model adapter, landing with the Plan 06 model plumbing) returns an
 * {@link ExtractionResult}; {@link applyExtraction} validates it and merges it
 * into the database. Nothing here calls a model — the contract is deliberately
 * model-agnostic so the deterministic apply pipeline can be built and tested
 * against hand-authored results before any model is wired in.
 *
 * Entities are connected by local string `ref`s rather than database ids,
 * because the model produces this graph before any rows exist. `applyExtraction`
 * resolves refs during apply. People and organizations may resolve to existing or
 * new ids; projects only resolve to manually created existing rows, and misses
 * become suggestions. Refs share one namespace across people / organizations /
 * projects / tasks, so a memory subject or a task link can name any of them by ref
 * alone.
 */

/** Memory categories (mirrors `memories.kind`; see the launch schema). */
export const MEMORY_KINDS = [
  'fact',
  'preference',
  'decision',
  'commitment',
  'instruction',
  'risk',
  'idea',
] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

const confidence = z.number().min(0).max(1).nullish()
const ref = z.string().min(1)

/**
 * A pointer from an extracted memory or task back to the exact source chunk that
 * supports it. `chunkIndex` is relative to the source record's `content_chunks`;
 * apply resolves it to a `chunk_id`. An index with no matching chunk is skipped
 * (and reported), never fatal.
 */
export const evidenceRefSchema = z.object({
  chunkIndex: z.number().int().nonnegative(),
  quoteStart: z.number().int().nonnegative().nullish(),
  quoteEnd: z.number().int().nonnegative().nullish(),
  note: z.string().nullish(),
})
export type ExtractedEvidence = z.infer<typeof evidenceRefSchema>

export const extractedPersonSchema = z.object({
  ref,
  fullName: z.string().min(1),
  preferredName: z.string().nullish(),
  primaryEmail: z.string().nullish(),
  primaryPhone: z.string().nullish(),
  headline: z.string().nullish(),
  location: z.string().nullish(),
  confidence,
})
export type ExtractedPerson = z.infer<typeof extractedPersonSchema>

export const extractedOrganizationSchema = z.object({
  ref,
  name: z.string().min(1),
  kind: z.string().nullish(),
  domain: z.string().nullish(),
  location: z.string().nullish(),
  confidence,
})
export type ExtractedOrganization = z.infer<typeof extractedOrganizationSchema>

export const extractedAffiliationSchema = z.object({
  personRef: ref,
  organizationRef: ref,
  title: z.string().nullish(),
  role: z.string().nullish(),
  isCurrent: z.boolean().nullish(),
  startedOn: z.string().nullish(),
  endedOn: z.string().nullish(),
  confidence,
})
export type ExtractedAffiliation = z.infer<typeof extractedAffiliationSchema>

export const extractedProjectSchema = z.object({
  ref,
  name: z.string().min(1),
  status: z.string().nullish(),
  kind: z.string().nullish(),
  summary: z.string().nullish(),
  targetDate: z.string().nullish(),
  confidence,
})
export type ExtractedProject = z.infer<typeof extractedProjectSchema>

export const extractedTaskSchema = z.object({
  ref,
  title: z.string().min(1),
  description: z.string().nullish(),
  status: z.string().nullish(),
  priority: z.number().int().nullish(),
  dueAt: z.string().nullish(),
  scheduledFor: z.string().nullish(),
  projectRef: ref.nullish(),
  personRefs: z.array(ref).default([]),
  organizationRefs: z.array(ref).default([]),
  evidence: z.array(evidenceRefSchema).default([]),
  confidence,
})
export type ExtractedTask = z.infer<typeof extractedTaskSchema>

/** A memory's link to another extracted entity (resolved by ref) with a role. */
export const memorySubjectSchema = z.object({
  ref,
  role: z.string().nullish(),
})
export type MemorySubject = z.infer<typeof memorySubjectSchema>

export const extractedMemorySchema = z.object({
  ref: ref.nullish(),
  kind: z.enum(MEMORY_KINDS).default('fact'),
  claim: z.string().min(1),
  confidence,
  validFrom: z.string().nullish(),
  validTo: z.string().nullish(),
  subjects: z.array(memorySubjectSchema).default([]),
  evidence: z.array(evidenceRefSchema).default([]),
})
export type ExtractedMemory = z.infer<typeof extractedMemorySchema>

export const extractionResultSchema = z.object({
  people: z.array(extractedPersonSchema).default([]),
  organizations: z.array(extractedOrganizationSchema).default([]),
  affiliations: z.array(extractedAffiliationSchema).default([]),
  projects: z.array(extractedProjectSchema).default([]),
  tasks: z.array(extractedTaskSchema).default([]),
  memories: z.array(extractedMemorySchema).default([]),
})

/** Input shape (pre-defaults). */
export type ExtractionResultInput = z.input<typeof extractionResultSchema>
/** Normalized shape (post-defaults) — what apply operates on. */
export type ExtractionResult = z.infer<typeof extractionResultSchema>

/** Parse/validate raw (model) output into a normalized {@link ExtractionResult}. */
export function parseExtractionResult(raw: unknown): ExtractionResult {
  return extractionResultSchema.parse(raw)
}

/**
 * Referential validation over a parsed result: ref uniqueness and that every
 * cross-reference resolves. Zod checks each object's shape; this checks the
 * graph. Returns a list of human-readable problems (empty when valid) so apply
 * can fail fast with a clear message and the checks stay unit-testable.
 */
export function validateExtraction(result: ExtractionResult): string[] {
  const problems: string[] = []

  // All entity refs live in one namespace and must be unique.
  const entityRefs = new Map<string, string>() // ref -> entity kind
  const claim = (kind: string, value: string) => {
    const existing = entityRefs.get(value)
    if (existing) {
      problems.push(`duplicate ref "${value}" (used by ${existing} and ${kind})`)
    } else {
      entityRefs.set(value, kind)
    }
  }
  for (const person of result.people) claim('person', person.ref)
  for (const organization of result.organizations) claim('organization', organization.ref)
  for (const project of result.projects) claim('project', project.ref)
  for (const task of result.tasks) claim('task', task.ref)

  const requireRef = (value: string | null | undefined, context: string) => {
    if (value == null) return
    if (!entityRefs.has(value)) problems.push(`${context} references unknown ref "${value}"`)
  }
  const requireType = (value: string, expected: string, context: string) => {
    const actual = entityRefs.get(value)
    if (actual && actual !== expected) {
      problems.push(`${context} expected a ${expected} ref but "${value}" is a ${actual}`)
    }
  }

  for (const affiliation of result.affiliations) {
    requireRef(affiliation.personRef, 'affiliation')
    requireType(affiliation.personRef, 'person', 'affiliation.personRef')
    requireRef(affiliation.organizationRef, 'affiliation')
    requireType(affiliation.organizationRef, 'organization', 'affiliation.organizationRef')
  }
  for (const task of result.tasks) {
    requireRef(task.projectRef, `task "${task.ref}"`)
    requireType(task.projectRef ?? '', 'project', `task "${task.ref}" projectRef`)
    for (const personRef of task.personRefs) {
      requireRef(personRef, `task "${task.ref}"`)
      requireType(personRef, 'person', `task "${task.ref}" personRef`)
    }
    for (const organizationRef of task.organizationRefs) {
      requireRef(organizationRef, `task "${task.ref}"`)
      requireType(organizationRef, 'organization', `task "${task.ref}" organizationRef`)
    }
  }
  for (const memory of result.memories) {
    for (const subject of memory.subjects) {
      requireRef(subject.ref, `memory "${memory.claim.slice(0, 24)}…"`)
    }
  }

  return problems
}
