import type { RecordKind } from '../domains/relations/types'
import { setExtractionHandler } from '../ingest/extraction-queue'
import { applyExtraction, type ApplyOptions, type ApplySummary } from './apply'
import { parseExtractionResult } from './contracts'
import { buildExtractionContext, type ExtractionContext, type SourceRecordType } from './preprocess'

/**
 * The model boundary seam (Plan 05 step 3).
 *
 * Real extraction needs a model. Rather than fake it with brittle heuristics,
 * Local Brain defines the boundary explicitly: an {@link Extractor} receives a
 * deterministic {@link ExtractionContext} (source text + chunks + hints +
 * dedupe candidates) and returns model output, which is validated against the
 * {@link parseExtractionResult} contract and merged deterministically by
 * {@link applyExtraction}.
 *
 * Until a BYOK model adapter is wired in (with the Plan 06 model plumbing), no
 * extractor is registered and {@link runExtraction} is a no-op — capture and the
 * whole deterministic apply pipeline work and are fully tested without it.
 */

export type Extractor = (
  context: ExtractionContext,
) => Promise<unknown> | unknown

let extractor: Extractor | null = null

/** Register (or clear) the model-backed extractor. */
export function setExtractor(next: Extractor | null): void {
  extractor = next
}

export function getExtractor(): Extractor | null {
  return extractor
}

function isSourceRecordType(kind: RecordKind): kind is SourceRecordType {
  return kind === 'document' || kind === 'interaction'
}

/**
 * Run the full pipeline for one record: build context, call the registered
 * extractor, validate its output, and apply it. Returns the apply summary, or
 * `null` when no extractor is registered or the record type isn't extractable.
 */
export async function runExtraction(
  recordType: RecordKind,
  recordId: string,
  options: ApplyOptions = {},
): Promise<ApplySummary | null> {
  const active = extractor
  if (!active || !isSourceRecordType(recordType)) return null

  const context = await buildExtractionContext(recordType, recordId)
  const raw = await active(context)
  const result = parseExtractionResult(raw)
  return applyExtraction({ recordType, recordId }, result, options)
}

/**
 * Wire extraction into ingestion: register `extractor` and install a
 * fire-and-forget handler on the ingest queue so each newly captured record is
 * extracted without blocking (or being able to fail) capture. Pass `null` to
 * detach both.
 */
export function installExtractionPipeline(
  next: Extractor | null,
  options: ApplyOptions = {},
): void {
  setExtractor(next)
  if (!next) {
    setExtractionHandler(null)
    return
  }
  setExtractionHandler((recordType, recordId) => {
    void runExtraction(recordType, recordId, options).catch(() => {
      /* extraction is best-effort; a model/apply failure must not surface to capture */
    })
  })
}
