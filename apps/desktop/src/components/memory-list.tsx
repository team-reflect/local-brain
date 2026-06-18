import type { ReactNode } from 'react'
import type { Memory } from '@local-brain/core'
import { useCitationsForSubject } from '../lib/queries'
import { CitationList } from './citation-list'
import { Section } from './section'

function MemoryCard({ memory }: { memory: Memory }): ReactNode {
  const citations = useCitationsForSubject('memory', memory.id)
  return (
    <li className="flex flex-col gap-1.5">
      <div>
        <p className="text-sm text-foreground">{memory.claim}</p>
        <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <span>{memory.kind}</span>
          {memory.confidence !== null ? (
            <span>· {Math.round(memory.confidence * 100)}% confidence</span>
          ) : null}
        </div>
      </div>
      {citations.data ? <CitationList title="Evidence" citations={citations.data} /> : null}
    </li>
  )
}

/** Memories about a record, each with the evidence that grounds it. */
export function MemoryList({ records }: { records: Memory[] }): ReactNode {
  if (records.length === 0) return null
  return (
    <Section title="Memories">
      <ul className="flex flex-col gap-3">
        {records.map((memory) => (
          <MemoryCard key={memory.id} memory={memory} />
        ))}
      </ul>
    </Section>
  )
}
