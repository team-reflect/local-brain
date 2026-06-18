import type { RecordKind } from '../domains/relations/types'

/**
 * Extraction seam (Plan 04 step 10). Ingestion calls `markForExtraction` after a
 * record and its chunks are committed, so memory extraction (Plan 05) can run
 * without blocking capture. Until Plan 05 registers a real handler this is a
 * no-op; a handler can be installed with `setExtractionHandler`.
 *
 * The contract is deliberately fire-and-forget: capture has already succeeded by
 * the time this runs, and a failing/absent handler must never surface as an
 * ingestion error.
 */
export type ExtractionHandler = (recordType: RecordKind, recordId: string) => void

let handler: ExtractionHandler | null = null

export function setExtractionHandler(next: ExtractionHandler | null): void {
  handler = next
}

export function markForExtraction(recordType: RecordKind, recordId: string): void {
  if (!handler) return
  try {
    handler(recordType, recordId)
  } catch {
    /* extraction is best-effort and must not fail the ingest that triggered it */
  }
}
