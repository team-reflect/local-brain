import type { Updateable } from 'kysely'
import type { EvidenceRefs } from '@local-brain/db'
import { db } from '../../db/client'
import { execute } from '../../db/commands'

/**
 * Correction setters for evidence / citations (Plan 05 step 8 — "fix a
 * citation / evidence link"). An `evidence_refs` row grounds a subject (a memory
 * or an extracted task) in a content chunk. The user can repoint it at the right
 * chunk, adjust the quoted span / note, or remove a citation that is simply
 * wrong. Evidence refs have no `archived_at`, so a wrong one is hard-deleted; the
 * subject it grounded is untouched.
 */

export type EvidencePatch = Pick<
  Updateable<EvidenceRefs>,
  'chunkId' | 'quoteStart' | 'quoteEnd' | 'note'
>

/** Fix a citation: repoint its chunk, adjust the quoted span, or edit the note. */
export function updateEvidenceRef(id: string, patch: EvidencePatch): Promise<number> {
  return execute(db.updateTable('evidenceRefs').set(patch).where('id', '=', id))
}

/** Remove a wrong citation. The grounded subject (memory/task) is left intact. */
export function removeEvidenceRef(id: string): Promise<number> {
  return execute(db.deleteFrom('evidenceRefs').where('id', '=', id))
}
