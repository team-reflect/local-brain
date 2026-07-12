import { describe, expect, it } from 'vitest'
import {
  chatSourcesFromMessageParts,
  chatSourcesFromToolPart,
  prepareChatCitationMarkdown,
  routeForChatSource,
} from './chat-sources'

describe('chat sources', () => {
  it('reads the stable records/evidence contract from browse results', () => {
    const sources = chatSourcesFromToolPart({
      type: 'tool-browse_records',
      state: 'output-available',
      output: {
        records: [
          {
            recordType: 'interaction',
            recordId: 'i1',
            recordRef: 'interaction:i1',
            title: 'Weekly sync',
            evidence: [
              { chunkId: 'c1', snippet: 'first' },
              { chunkId: 'c2', snippet: 'second' },
            ],
          },
        ],
      },
    })

    expect(sources).toHaveLength(1)
    expect([...sources[0]!.chunkIds]).toEqual(['c1', 'c2'])
  })

  it('merges duplicate record candidates and allows only returned chunk refs', () => {
    const sources = chatSourcesFromMessageParts([
      {
        type: 'tool-search_records',
        state: 'output-available',
        output: {
          records: [
            {
              recordType: 'document',
              recordId: 'd1',
              title: 'Source',
              evidence: [{ chunkId: 'c1' }],
            },
          ],
        },
      },
      {
        type: 'tool-get_records',
        state: 'output-available',
        output: {
          records: [
            {
              recordRef: 'document:d1',
              found: true,
              chunks: [{ chunkId: 'c2' }],
            },
          ],
        },
      },
    ])

    expect([...sources.get('document:d1')!.chunkIds]).toEqual(['c1', 'c2'])
    const rendered = prepareChatCitationMarkdown(
      '[[record:document:d1#c2]] [[record:document:d1#not-returned]]',
      sources,
    )
    expect(rendered).toContain('#local-brain-citation=')
    expect(rendered).toContain('[[record:document:d1#not-returned]]')
  })

  it.each([
    ['list_tasks', 'task', 't1', 'Send proposal'],
    ['list_projects', 'project', 'p1', 'Atlas'],
  ])('reads stable sources from %s', (toolName, recordType, recordId, title) => {
    const sources = chatSourcesFromToolPart({
      type: `tool-${toolName}`,
      state: 'output-available',
      output: {
        records: [
          {
            recordType,
            recordId,
            recordRef: `${recordType}:${recordId}`,
            title,
            date: '2026-07-12',
          },
        ],
      },
    })

    expect(sources).toEqual([
      expect.objectContaining({ recordRef: `${recordType}:${recordId}`, title }),
    ])
  })

  it.each([
    ['organization_profile', 'profile-1', { organizationId: 'org-1' }, { kind: 'organization', id: 'org-1' }],
    ['interaction_transcript', 'transcript-1', { interactionId: 'interaction-1' }, { kind: 'interaction', id: 'interaction-1' }],
    ['ai_note', 'note-1', { documentId: 'document-1' }, { kind: 'document', id: 'document-1' }],
    ['extracted_fact', 'fact-1', { sourceRecordType: 'interaction', sourceRecordId: 'interaction-2' }, { kind: 'interaction', id: 'interaction-2' }],
  ])('opens a grounded %s source at its owning record', (recordType, recordId, metadata, route) => {
    const [source] = chatSourcesFromToolPart({
      type: 'tool-get_records',
      state: 'output-available',
      output: {
        records: [{ recordType, recordId, recordRef: `${recordType}:${recordId}`, metadata }],
      },
    })

    expect(source).toBeDefined()
    expect(routeForChatSource(source!)).toEqual(route)
  })

  it('keeps an ambiguously anchored AI note inert', () => {
    const [source] = chatSourcesFromToolPart({
      type: 'tool-get_records',
      state: 'output-available',
      output: {
        records: [{
          recordType: 'ai_note',
          recordId: 'note-1',
          metadata: { interactionId: 'interaction-1', documentId: 'document-1' },
        }],
      },
    })

    expect(source).toBeDefined()
    expect(routeForChatSource(source!)).toBeNull()
  })

  it('opens a derived search hit through its explicit navigation target', () => {
    const [source] = chatSourcesFromToolPart({
      type: 'tool-search_records',
      state: 'output-available',
      output: {
        records: [{
          recordType: 'interaction_transcript',
          recordId: 'transcript-1',
          recordRef: 'interaction_transcript:transcript-1',
          title: 'Transcript from sync',
          navigationRecordType: 'interaction',
          navigationRecordId: 'interaction-1',
          evidence: [{ chunkId: 'chunk-1' }],
        }],
      },
    })

    expect(source).toBeDefined()
    expect(routeForChatSource(source!)).toEqual({ kind: 'interaction', id: 'interaction-1' })
  })
})
