import type { ReactNode } from 'react'
import type {
  ProjectAiNote,
  ProjectExtractedFact,
  ProjectIntelligence,
  ProjectMemory,
  ProjectTag,
} from '@local-brain/core'
import { Badge } from './badge'
import { Section } from './section'
import { useCitationsForSubject } from '../lib/queries'
import { cn } from '../lib/utils'
import { metaText, sectionLabel } from '../lib/ui'

function confidenceLabel(confidence: number | null): string | null {
  if (confidence === null) return null
  return `${Math.round(confidence * 100)}% confidence`
}

function displayDate(value: string | null): string | null {
  if (!value) return null
  return value.slice(0, 10)
}

function titleCase(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function factValue(fact: ProjectExtractedFact): string {
  if (fact.valueText) return fact.valueText
  if (!fact.valueJson) return ''
  try {
    const parsed: unknown = JSON.parse(fact.valueJson)
    if (typeof parsed === 'string') return parsed
    return JSON.stringify(parsed)
  } catch {
    return fact.valueJson
  }
}

function ProjectTags({ tags }: { tags: ProjectTag[] }): ReactNode {
  if (tags.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag.id}
          title={tag.description ?? tag.slug ?? tag.name}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-2.5 py-1 text-xs text-foreground"
        >
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: tag.color ?? 'var(--muted-foreground)' }}
          />
          {tag.name}
        </span>
      ))}
    </div>
  )
}

function ProjectNotes({ notes, tags }: { notes: string | null; tags: ProjectTag[] }): ReactNode {
  if (!notes && tags.length === 0) return null
  return (
    <Section title="Project context">
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        {notes ? (
          <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{notes}</p>
        ) : null}
        {tags.length > 0 ? (
          <div className={cn(notes ? 'mt-3 border-t border-border pt-3' : '')}>
            <ProjectTags tags={tags} />
          </div>
        ) : null}
      </div>
    </Section>
  )
}

function CitationPreview({
  subjectType,
  subjectId,
}: {
  subjectType: string
  subjectId: string
}): ReactNode {
  const citations = useCitationsForSubject(subjectType, subjectId)
  const rows = citations.data ?? []
  if (rows.length === 0) return null
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {rows.slice(0, 2).map((citation) => (
        <div key={citation.id} className="border-l-2 border-primary/35 pl-2.5">
          <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{citation.quote}</p>
          <p className={cn(metaText, 'mt-0.5')}>{citation.sourceTitle ?? citation.sourceType}</p>
        </div>
      ))}
      {rows.length > 2 ? (
        <p className={metaText}>{rows.length - 2} more citations</p>
      ) : null}
    </div>
  )
}

function KnowledgeCard({
  tone,
  label,
  title,
  body,
  meta,
  subjectType,
  subjectId,
}: {
  tone: 'accent' | 'success' | 'warning' | 'neutral'
  label: string
  title: string
  body?: ReactNode
  meta?: ReactNode
  subjectType: string
  subjectId: string
}): ReactNode {
  return (
    <li className="rounded-lg border border-border bg-card px-4 py-3 shadow-sm shadow-black/[0.02]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <Badge tone={tone}>{label}</Badge>
            {meta ? <span className={metaText}>{meta}</span> : null}
          </div>
          <h3 className="text-sm font-medium leading-5 text-foreground">{title}</h3>
        </div>
      </div>
      {body ? <div className="mt-2 text-sm leading-6 text-muted-foreground">{body}</div> : null}
      <CitationPreview subjectType={subjectType} subjectId={subjectId} />
    </li>
  )
}

function MemoryCards({ memories }: { memories: ProjectMemory[] }): ReactNode {
  return memories.map((memory) => (
    <KnowledgeCard
      key={memory.id}
      tone="accent"
      label={titleCase(memory.kind)}
      title={memory.claim}
      meta={confidenceLabel(memory.confidence)}
      subjectType="memory"
      subjectId={memory.id}
    />
  ))
}

function FactCards({ facts }: { facts: ProjectExtractedFact[] }): ReactNode {
  return facts.map((fact) => (
    <KnowledgeCard
      key={fact.id}
      tone="success"
      label={titleCase(fact.key)}
      title={factValue(fact)}
      body={fact.sourceExcerpt ? <span>{fact.sourceExcerpt}</span> : null}
      meta={confidenceLabel(fact.confidence) ?? displayDate(fact.observedAt)}
      subjectType="extracted_fact"
      subjectId={fact.id}
    />
  ))
}

function AiNoteCards({ notes }: { notes: ProjectAiNote[] }): ReactNode {
  return notes.map((note) => (
    <KnowledgeCard
      key={note.id}
      tone="warning"
      label={titleCase(note.kind)}
      title={note.title ?? 'AI note'}
      body={<p className="whitespace-pre-wrap">{note.content}</p>}
      meta={displayDate(note.generatedAt ?? note.createdAt)}
      subjectType="ai_note"
      subjectId={note.id}
    />
  ))
}

export function ProjectKnowledge({
  notes,
  intelligence,
}: {
  notes: string | null
  intelligence: ProjectIntelligence
}): ReactNode {
  const itemCount =
    intelligence.memories.length + intelligence.extractedFacts.length + intelligence.aiNotes.length
  return (
    <>
      <ProjectNotes notes={notes} tags={intelligence.tags} />
      {itemCount > 0 ? (
        <Section
          title="Knowledge"
          action={<span className={metaText}>{itemCount} items</span>}
        >
          <div className="grid gap-3 lg:grid-cols-2">
            {intelligence.memories.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h3 className={sectionLabel}>Memories</h3>
                <ul className="flex flex-col gap-2">
                  <MemoryCards memories={intelligence.memories} />
                </ul>
              </div>
            ) : null}
            {intelligence.extractedFacts.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h3 className={sectionLabel}>Extracted facts</h3>
                <ul className="flex flex-col gap-2">
                  <FactCards facts={intelligence.extractedFacts} />
                </ul>
              </div>
            ) : null}
            {intelligence.aiNotes.length > 0 ? (
              <div className="flex flex-col gap-2 lg:col-span-2">
                <h3 className={sectionLabel}>AI notes</h3>
                <ul className="grid gap-2 lg:grid-cols-2">
                  <AiNoteCards notes={intelligence.aiNotes} />
                </ul>
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}
    </>
  )
}
