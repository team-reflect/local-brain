import type { ReactNode } from 'react'
import type { Memory } from '@local-brain/core'
import {
  useArchiveMemory,
  useCitationsForSubject,
  useRemoveEvidenceRef,
  useUnlinkMemory,
} from '../lib/queries'
import { CitationList } from './citation-list'
import { Section } from './section'

interface CorrectionContext {
  recordType: string
  recordId: string
}

function contextKindLabel(kind: string): string {
  return kind.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function MemoryCard({
  memory,
  correction,
}: {
  memory: Memory
  correction?: CorrectionContext | undefined
}): ReactNode {
  const citations = useCitationsForSubject('memory', memory.id)
  const archive = useArchiveMemory()
  const unlink = useUnlinkMemory()
  const removeEvidence = useRemoveEvidenceRef()

  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-foreground">{memory.claim}</p>
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <span>{contextKindLabel(memory.kind)}</span>
            {memory.confidence !== null ? (
              <span>· {Math.round(memory.confidence * 100)}% confidence</span>
            ) : null}
          </div>
        </div>
        {correction ? (
          <div className="flex shrink-0 items-center gap-2 text-[11px]">
            <button
              type="button"
              onClick={() =>
                unlink.mutate({
                  memoryId: memory.id,
                  recordType: correction.recordType,
                  recordId: correction.recordId,
                })
              }
              className="text-muted-foreground hover:text-destructive"
            >
              Unlink
            </button>
            <button
              type="button"
              onClick={() => archive.mutate(memory.id)}
              className="text-muted-foreground hover:text-destructive"
            >
              Archive
            </button>
          </div>
        ) : null}
      </div>
      {citations.data ? (
        <CitationList
          title="Evidence"
          citations={citations.data}
          onRemove={correction ? (citation) => removeEvidence.mutate(citation.id) : undefined}
        />
      ) : null}
    </li>
  )
}

/**
 * Curated context about a record, each with the evidence that grounds it. Pass
 * `recordType`/`recordId` to enable in-place corrections (Plan 05b): unlink the
 * claim from this record, archive it, or remove a wrong citation.
 */
export function MemoryList({
  records,
  recordType,
  recordId,
}: {
  records: Memory[]
  recordType?: string
  recordId?: string
}): ReactNode {
  if (records.length === 0) return null
  const correction =
    recordType !== undefined && recordId !== undefined ? { recordType, recordId } : undefined
  return (
    <Section title="Known context">
      <ul className="flex flex-col gap-3">
        {records.map((memory) => (
          <MemoryCard key={memory.id} memory={memory} correction={correction} />
        ))}
      </ul>
    </Section>
  )
}
