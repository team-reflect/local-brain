import type { EmbeddingsStatus } from '@local-brain/core'
import { todayLocalDayKey } from '../../lib/queries'

/** Human-readable megabytes for download/size readouts. */
export function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * One-line semantic-search summary, shared by the Semantic search section and
 * Diagnostics so the two never drift.
 */
export function describeSemantic(status: EmbeddingsStatus | undefined): string {
  if (!status) return '…'
  if (!status.enabled) return 'off (lexical fallback)'
  // A backfill failure leaves the runtime `ready` but indexing stalled — report
  // the stall rather than the (now misleading) "indexing — n/m chunks" line.
  if (status.backfillError) return `indexing failed: ${status.backfillError}`
  switch (status.runtime.status) {
    case 'failed':
      return `error: ${status.runtime.message}`
    case 'loading':
      return 'downloading model…'
    case 'uninitialized':
      return 'preparing…'
    case 'ready':
      return status.pending > 0
        ? `indexing — ${status.indexed}/${status.totalChunks} chunks`
        : `on — ${status.indexed} chunks indexed`
  }
}

export function describeLastBackfill(day: string | null | undefined): string {
  if (!day) return 'never'
  return day === todayLocalDayKey() ? 'today' : day
}
