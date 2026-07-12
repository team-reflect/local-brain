import type { Route } from '../../routing/route'
import { routeForRecord } from '../../routing/route'

/** One read-tool record that may support a source row or same-message citation. */
export interface ChatSource {
  recordType: string
  recordId: string
  recordRef: string
  title: string | null
  date: string | null
  chunkIds: ReadonlySet<string>
  available: boolean
  navigationRecordType: NavigableRecordType | null
  navigationRecordId: string | null
}

/** Minimal settled AI SDK tool-part shape consumed by source extraction. */
export interface ChatSourceToolPart {
  type?: string
  state?: string
  output?: Record<string, unknown>
}

const RECORD_TYPE_LABELS: Record<string, string> = {
  person: 'Person',
  organization: 'Organization',
  organization_profile: 'Organization profile',
  project: 'Project',
  task: 'Task',
  document: 'Document',
  interaction: 'Interaction',
  interaction_transcript: 'Transcript',
  ai_note: 'AI note',
  extracted_fact: 'Fact',
  memory: 'Memory',
  asset: 'File',
}

const CITATION_PATTERN = /\[\[record:([a-z_]+):([^\]#\s]+)(?:#([^\]\s]+))?\]\]/g
const CITATION_HREF_PREFIX = '#local-brain-citation='

type NavigableRecordType =
  | 'person'
  | 'organization'
  | 'project'
  | 'task'
  | 'document'
  | 'interaction'
  | 'asset'

function nonBlankString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(objectRecord).filter((item): item is Record<string, unknown> => item !== null)
    : []
}

function parseRecordRef(value: unknown): { recordType: string; recordId: string } | null {
  const recordRef = nonBlankString(value)
  if (!recordRef) return null
  const separator = recordRef.indexOf(':')
  if (separator <= 0 || separator === recordRef.length - 1) return null
  return {
    recordType: recordRef.slice(0, separator),
    recordId: recordRef.slice(separator + 1),
  }
}

function chunkIdsFromRecord(record: Record<string, unknown>): Set<string> {
  const chunkIds = new Set<string>()
  const direct = nonBlankString(record['chunkId'])
  if (direct) chunkIds.add(direct)

  for (const key of ['evidence', 'chunks']) {
    for (const item of objectArray(record[key])) {
      const chunkId = nonBlankString(item['chunkId']) ?? nonBlankString(item['id'])
      if (chunkId) chunkIds.add(chunkId)
    }
  }
  return chunkIds
}

function navigableRecordType(value: unknown): NavigableRecordType | null {
  switch (value) {
    case 'person':
    case 'organization':
    case 'project':
    case 'task':
    case 'document':
    case 'interaction':
    case 'asset':
      return value
    default:
      return null
  }
}

function metadataNavigationTarget(
  recordType: string,
  metadata: Record<string, unknown> | null,
): { recordType: NavigableRecordType; recordId: string } | null {
  if (!metadata) return null
  if (recordType === 'organization_profile') {
    const recordId = nonBlankString(metadata['organizationId'])
    return recordId ? { recordType: 'organization', recordId } : null
  }
  if (recordType === 'interaction_transcript') {
    const recordId = nonBlankString(metadata['interactionId'])
    return recordId ? { recordType: 'interaction', recordId } : null
  }
  if (recordType === 'extracted_fact') {
    const sourceRecordType = navigableRecordType(metadata['sourceRecordType'])
    const sourceRecordId = nonBlankString(metadata['sourceRecordId'])
    if (sourceRecordType && sourceRecordId) {
      return { recordType: sourceRecordType, recordId: sourceRecordId }
    }
  }
  if (recordType !== 'ai_note' && recordType !== 'extracted_fact') return null

  const candidates = new Map<string, { recordType: NavigableRecordType; recordId: string }>()
  const add = (type: unknown, id: unknown): void => {
    const recordType = navigableRecordType(type)
    const recordId = nonBlankString(id)
    if (recordType && recordId) candidates.set(`${recordType}:${recordId}`, { recordType, recordId })
  }
  add('interaction', metadata['interactionId'])
  add('document', metadata['documentId'])
  add(metadata['subjectType'], metadata['subjectId'])
  return candidates.size === 1 ? [...candidates.values()][0] ?? null : null
}

function sourceFromRecord(record: Record<string, unknown>): ChatSource | null {
  const parsedRef = parseRecordRef(record['recordRef'])
  const recordType = nonBlankString(record['recordType']) ?? parsedRef?.recordType ?? null
  const recordId = nonBlankString(record['recordId']) ?? parsedRef?.recordId ?? null
  if (!recordType || !recordId) return null
  const explicitNavigationType = navigableRecordType(record['navigationRecordType'])
  const explicitNavigationId = nonBlankString(record['navigationRecordId'])
  const directNavigationType = navigableRecordType(recordType)
  const navigation = explicitNavigationType && explicitNavigationId
    ? { recordType: explicitNavigationType, recordId: explicitNavigationId }
    : directNavigationType
      ? { recordType: directNavigationType, recordId }
      : metadataNavigationTarget(recordType, objectRecord(record['metadata']))

  return {
    recordType,
    recordId,
    recordRef: `${recordType}:${recordId}`,
    title:
      nonBlankString(record['title']) ??
      nonBlankString(record['name']) ??
      nonBlankString(record['recordTitle']),
    date:
      nonBlankString(record['date']) ??
      nonBlankString(record['recordDate']) ??
      nonBlankString(record['occurredAt']) ??
      nonBlankString(record['updatedAt']),
    chunkIds: chunkIdsFromRecord(record),
    available: record['found'] !== false && record['archived'] !== true,
    navigationRecordType: navigation?.recordType ?? null,
    navigationRecordId: navigation?.recordId ?? null,
  }
}

function mergeSource(current: ChatSource | undefined, incoming: ChatSource): ChatSource {
  if (!current) return incoming
  return {
    ...current,
    title: incoming.title ?? current.title,
    date: incoming.date ?? current.date,
    chunkIds: new Set([...current.chunkIds, ...incoming.chunkIds]),
    // A later detail lookup can reveal that a search hit was archived/missing.
    available: current.available && incoming.available,
    navigationRecordType: incoming.navigationRecordType ?? current.navigationRecordType,
    navigationRecordId: incoming.navigationRecordId ?? current.navigationRecordId,
  }
}

/** Sources carried by one settled read-tool output. */
export function chatSourcesFromToolPart(part: ChatSourceToolPart): ChatSource[] {
  if (part.state !== 'output-available' || !part.output) return []
  const toolName = part.type?.startsWith('tool-') ? part.type.slice(5) : part.type
  const keys = toolName === 'search_records' || toolName === 'browse_records'
    ? ['records', 'hits', 'candidates']
    : toolName === 'get_records' || toolName === 'list_tasks' || toolName === 'list_projects'
      ? ['records']
      : []
  const sources = new Map<string, ChatSource>()

  for (const key of keys) {
    for (const record of objectArray(part.output[key])) {
      const source = sourceFromRecord(record)
      if (source) sources.set(source.recordRef, mergeSource(sources.get(source.recordRef), source))
    }
  }

  return [...sources.values()]
}

/** Allowed citation sources for one assistant message, merged across its read tools. */
export function chatSourcesFromMessageParts(parts: readonly unknown[]): Map<string, ChatSource> {
  const sources = new Map<string, ChatSource>()
  for (const value of parts) {
    const part = objectRecord(value)
    if (!part) continue
    for (const source of chatSourcesFromToolPart(part as ChatSourceToolPart)) {
      sources.set(source.recordRef, mergeSource(sources.get(source.recordRef), source))
    }
  }
  return sources
}

/** Resolve a direct or derived detail target; unavailable/inert sources return null. */
export function routeForChatSource(source: ChatSource): Route | null {
  if (!source.available || !source.navigationRecordType || !source.navigationRecordId) return null
  return routeForRecord(source.navigationRecordType, source.navigationRecordId)
}

/** Human-readable label for a Local Brain source record type. */
export function chatSourceTypeLabel(recordType: string): string {
  return RECORD_TYPE_LABELS[recordType] ?? recordType.replace(/_/g, ' ')
}

/** Compact an ISO-like source date to YYYY-MM-DD while preserving unknown formats. */
export function chatSourceDateLabel(date: string | null): string | null {
  if (!date) return null
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(date)
  return match?.[1] ?? date
}

function citationRef(recordType: string, recordId: string, chunkId?: string): string {
  return `${recordType}:${recordId}${chunkId ? `#${chunkId}` : ''}`
}

function sourceAllowsCitation(source: ChatSource | undefined, chunkId?: string): source is ChatSource {
  return Boolean(
    source?.available && (chunkId === undefined || source.chunkIds.has(chunkId)),
  )
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/([\\[\]])/g, '\\$1')
}

/**
 * Convert only tool-validated `[[record:type:id#chunk]]` citations into safe
 * internal Markdown links. Unsupported/hallucinated refs stay verbatim text.
 */
export function prepareChatCitationMarkdown(
  text: string,
  sources: ReadonlyMap<string, ChatSource>,
): string {
  return text.replace(
    CITATION_PATTERN,
    (raw, recordType: string, recordId: string, chunkId: string | undefined) => {
      const source = sources.get(`${recordType}:${recordId}`)
      if (!sourceAllowsCitation(source, chunkId)) return raw
      const ref = citationRef(recordType, recordId, chunkId)
      const label = escapeMarkdownLabel(
        (source.title ?? source.recordRef).replace(/\s+/g, ' ').trim(),
      )
      return `[${label}](${CITATION_HREF_PREFIX}${encodeURIComponent(ref)})`
    },
  )
}

/** Resolve and revalidate one internal href emitted by prepareChatCitationMarkdown. */
export function chatSourceForCitationHref(
  href: string | undefined,
  sources: ReadonlyMap<string, ChatSource>,
): ChatSource | null {
  if (!href?.startsWith(CITATION_HREF_PREFIX)) return null
  let ref: string
  try {
    ref = decodeURIComponent(href.slice(CITATION_HREF_PREFIX.length))
  } catch {
    return null
  }
  const chunkSeparator = ref.lastIndexOf('#')
  const recordRef = chunkSeparator === -1 ? ref : ref.slice(0, chunkSeparator)
  const chunkId = chunkSeparator === -1 ? undefined : ref.slice(chunkSeparator + 1)
  const source = sources.get(recordRef)
  return sourceAllowsCitation(source, chunkId) ? source : null
}

/** Whether a link uses the private citation href namespace handled by Chat. */
export function isChatCitationHref(href: string | undefined): boolean {
  return href?.startsWith(CITATION_HREF_PREFIX) ?? false
}
