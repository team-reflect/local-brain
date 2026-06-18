import { db } from '../db/client'
import { newId } from '../db/id'
import type { ExtractionResult } from './contracts'
import { loadMemoryClaims } from './apply-store'
import type { ApplyContext } from './apply-context'

/**
 * Memory applier for {@link applyExtraction}. A memory whose subject was
 * gated/unresolved would land without its intended subject — a fact about no one
 * — so it is held back as a suggestion. Each written memory is always linked to
 * its source record (role `source`) and to every resolved subject, de-duplicated,
 * with evidence chunks attached. Exact claim duplicates are skipped.
 */
export async function applyMemories(
  ctx: ApplyContext,
  memories: ExtractionResult['memories'],
): Promise<void> {
  const existingClaims = await loadMemoryClaims()
  for (const memory of memories) {
    if (!ctx.accepts(memory.confidence)) {
      ctx.suggest('memory', memory.ref, memory.claim, memory.confidence)
      continue
    }
    if (ctx.hasUnresolved(memory.subjects.map((subject) => subject.ref))) {
      ctx.suggest('memory', memory.ref, memory.claim, memory.confidence)
      continue
    }
    const claimKey = memory.claim.trim().toLowerCase()
    if (existingClaims.has(claimKey)) {
      ctx.summary.memories.duplicate++
      continue
    }
    existingClaims.add(claimKey)

    const id = newId()
    ctx.inserts.memories.push(
      db.insertInto('memories').values({
        id,
        kind: memory.kind,
        claim: memory.claim,
        confidence: memory.confidence ?? null,
        validFrom: memory.validFrom ?? null,
        validTo: memory.validTo ?? null,
      }),
    )
    ctx.summary.memories.created++

    // Always link the memory to its source record.
    ctx.inserts.memoryLinks.push(
      db.insertInto('memoryLinks').values({
        id: newId(),
        memoryId: id,
        recordType: ctx.source.recordType,
        recordId: ctx.source.recordId,
        role: 'source',
      }),
    )
    ctx.summary.links.created++

    const linkedRecords = new Set<string>([`${ctx.source.recordType}:${ctx.source.recordId}`])
    for (const subject of memory.subjects) {
      const target = ctx.resolved.get(subject.ref)
      if (!target) continue
      const dedupeKey = `${target.type}:${target.id}`
      if (linkedRecords.has(dedupeKey)) continue
      linkedRecords.add(dedupeKey)
      ctx.inserts.memoryLinks.push(
        db.insertInto('memoryLinks').values({
          id: newId(),
          memoryId: id,
          recordType: target.type,
          recordId: target.id,
          role: subject.role ?? null,
        }),
      )
      ctx.summary.links.created++
    }
    ctx.pushEvidence('memory', id, memory.evidence)
  }
}
