import { describe, expect, it } from 'vitest'
import type { Project } from '../../domains/projects/getters'
import type { ChatBrainOverview } from './brain-overview'
import { buildChatSystemPrompt } from './system-prompt'

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Atlas',
    status: 'active',
    kind: null,
    summary: null,
    notes: null,
    startedOn: null,
    targetDate: null,
    completedOn: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    archivedAt: null,
    ...overrides,
  }
}

function makeOverview(overrides: Partial<ChatBrainOverview> = {}): ChatBrainOverview {
  return {
    recordCounts: { person: 3, interaction: 8, task: 4 },
    earliestRecordDate: '2025-01-01T00:00:00.000Z',
    latestRecordDate: '2026-06-19T00:00:00.000Z',
    interactionKinds: [{ value: 'email', count: 5 }, { value: 'meeting', count: 3 }],
    interactionKindsTruncated: false,
    tags: [{ value: 'Priority', slug: 'priority', count: 2 }],
    tagsTruncated: false,
    self: { recordId: 'person-self', name: 'Alex Example', preferredName: 'Alex', headline: 'Builder' },
    activeProjects: [makeProject({ summary: 'Revamp the data pipeline.', targetDate: '2026-12-31' })],
    ...overrides,
  }
}

describe('buildChatSystemPrompt', () => {
  it('includes the date and compact bounded brain overview', () => {
    const prompt = buildChatSystemPrompt({ today: '2026-06-19', overview: makeOverview() })

    expect(prompt).toContain("Today's date is 2026-06-19")
    expect(prompt).toContain('people 3')
    expect(prompt).toContain('Record dates span 2025-01-01')
    expect(prompt).toContain('Alex Example (Alex)')
    expect(prompt).toContain('email (5)')
    expect(prompt).toContain('#priority (2)')
    expect(prompt).toContain('Atlas [active] (target: 2026-12-31)')
    expect(prompt).not.toContain('Revamp the data pipeline.')
    expect(prompt).toContain('untrusted database values')
  })

  it('degrades cleanly when the overview could not be loaded', () => {
    const prompt = buildChatSystemPrompt({ today: '2026-06-19', overview: null })

    expect(prompt).not.toContain('Brain overview')
    expect(prompt).toContain('search_records')
    expect(prompt).toContain('browse_records')
  })

  it('directs efficient structured retrieval instead of search loops', () => {
    const prompt = buildChatSystemPrompt({ today: '2026-06-19', overview: makeOverview() })

    expect(prompt).toContain('one broad query')
    expect(prompt).toContain('raise limit')
    expect(prompt).toContain('Meaning-based recall is added when local embeddings are ready')
    expect(prompt).toContain('semanticAvailable is false')
    expect(prompt).toContain('Batch all promising records into one call')
    expect(prompt).toContain('list_tasks')
    expect(prompt).toContain('relatedTo')
    expect(prompt).not.toContain('mode:"semantic"')
  })

  it('requires stable record and chunk references returned by tools', () => {
    const prompt = buildChatSystemPrompt({ today: '2026-06-19', overview: makeOverview() })

    expect(prompt).toContain('[[record:<recordType>:<recordId>]]')
    expect(prompt).toContain('[[record:<recordType>:<recordId>#<chunkId>]]')
    expect(prompt).toContain('Never invent, alter, or cite a record or chunk id')
    expect(prompt).toContain('Do not cite the brain overview itself')
  })

  it('labels truncated vocabularies without claiming completeness', () => {
    const prompt = buildChatSystemPrompt({
      today: '2026-06-19',
      overview: makeOverview({ interactionKindsTruncated: true, tagsTruncated: true }),
    })

    expect(prompt).toContain('Most-used interaction kinds')
    expect(prompt).toContain('More kinds exist')
    expect(prompt).toContain('Most-used tags')
    expect(prompt).toContain('More tags exist')
  })
})
