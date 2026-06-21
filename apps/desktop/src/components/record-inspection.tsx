import type { ReactNode } from 'react'
import type { RecordInspection } from '@local-brain/core'
import { DetailFields } from './detail-fields'
import { Section } from './section'

type InspectableRow = object

interface InspectionSection {
  title: string
  rows: InspectableRow[]
}

const EMPTY_VALUES = new Set<unknown>([null, undefined, ''])

export function RecordInspectionPanel({
  inspection,
}: {
  inspection: RecordInspection | undefined
}): ReactNode {
  if (!inspection || !hasInspectionData(inspection)) return null

  const sections: InspectionSection[] = [
    { title: 'Emails', rows: inspection.personEmails },
    { title: 'Phones', rows: inspection.personPhones },
    { title: 'Affiliations', rows: inspection.affiliations },
    { title: 'Organization profiles', rows: inspection.organizationProfiles },
    { title: 'Interaction participant rows', rows: inspection.interactionParticipants },
    { title: 'Interaction transcripts', rows: inspection.interactionTranscripts },
    { title: 'External identities', rows: inspection.externalIdentities },
    { title: 'Provenance', rows: inspection.provenance },
    { title: 'Tags', rows: inspection.tags },
    { title: 'Extracted facts', rows: inspection.extractedFacts },
    { title: 'AI notes', rows: inspection.aiNotes },
    { title: 'Content chunks', rows: inspection.contentChunks },
    { title: 'Evidence refs', rows: inspection.evidenceRefs },
    { title: 'Memory links', rows: inspection.memoryLinks },
    { title: 'Asset link rows', rows: inspection.assetLinks },
  ]

  return (
    <>
      {inspection.relationshipSummary ? (
        <InspectionRows title="Relationship intelligence" rows={[inspection.relationshipSummary]} />
      ) : null}
      {sections.map((section) => (
        <InspectionRows key={section.title} title={section.title} rows={section.rows} />
      ))}
    </>
  )
}

function InspectionRows({ title, rows }: InspectionSection): ReactNode {
  if (rows.length === 0) return null
  return (
    <Section title={title}>
      <ul className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <li key={rowKey(row, index)} className="rounded-md border border-border bg-secondary/20 p-3">
            <DetailFields fields={toFields(row)} />
          </li>
        ))}
      </ul>
    </Section>
  )
}

function toFields(row: InspectableRow): Array<{ label: string; value: ReactNode }> {
  const fields = Object.entries(row)
    .filter(([, value]) => !EMPTY_VALUES.has(value))
    .map(([key, value]) => ({ label: humanizeKey(key), value: formatValue(value) }))
  return fields.length > 0 ? fields : [{ label: 'Value', value: '—' }]
}

function formatValue(value: unknown): ReactNode {
  if (typeof value === 'number') return Number.isInteger(value) ? value.toLocaleString() : String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value !== 'string') return String(value)

  const formattedJson = maybeFormatJson(value)
  if (formattedJson !== null) {
    return (
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
        {formattedJson}
      </pre>
    )
  }
  if (value.includes('\n') || value.length > 120) {
    return (
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
        {value}
      </pre>
    )
  }
  return value
}

function maybeFormatJson(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return null
  }
}

function rowKey(row: InspectableRow, index: number): string {
  const id = Object.entries(row).find(([key, value]) => key === 'id' && typeof value === 'string')
  return id ? id[1] : String(index)
}

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (first) => first.toUpperCase())
}

function hasInspectionData(inspection: RecordInspection): boolean {
  return (
    inspection.relationshipSummary !== null ||
    inspection.personEmails.length > 0 ||
    inspection.personPhones.length > 0 ||
    inspection.affiliations.length > 0 ||
    inspection.organizationProfiles.length > 0 ||
    inspection.interactionParticipants.length > 0 ||
    inspection.interactionTranscripts.length > 0 ||
    inspection.externalIdentities.length > 0 ||
    inspection.provenance.length > 0 ||
    inspection.tags.length > 0 ||
    inspection.extractedFacts.length > 0 ||
    inspection.aiNotes.length > 0 ||
    inspection.contentChunks.length > 0 ||
    inspection.evidenceRefs.length > 0 ||
    inspection.memoryLinks.length > 0 ||
    inspection.assetLinks.length > 0
  )
}
