// Real-SQLite integration tests for Plan 06: FTS retrieval, global search, the
// model boundary, the model-backed extractor, and the
// agent report endpoints. Uses the shared node:sqlite harness so FTS5 (bm25,
// snippet) runs end to end against the actual migrations. The model provider is
// a deterministic mock — real keys are not needed to exercise the boundary
// contract.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createModelExtractor,
  createTask,
  getChangesSince,
  getDailyBrief,
  getModelStatus,
  globalSearch,
  ingestDocument,
  ingestInteraction,
  listPeople,
  planDay,
  retrieve,
  runExtraction,
  setExtractor,
  setModelProvider,
} from '@local-brain/core'
import { freshDatabase, installSqliteBridge } from './sqlite-harness.mjs'

/** A deterministic stand-in for a BYOK provider. */
function mockProvider(reply) {
  return {
    id: 'mock',
    label: 'Mock',
    model: 'mock-1',
    isAvailable: () => true,
    generate: async (request) => ({ text: reply(request), model: 'mock-1' }),
  }
}

async function seedCorpus() {
  await ingestDocument({
    title: 'Northwind partnership proposal',
    bodyText:
      'Alex Rivera founded Northwind Labs. The partnership proposal covers a joint go-to-market plan for the analytics product.',
  })
  await ingestInteraction({
    kind: 'meeting',
    title: 'Weekly sync',
    bodyText: 'Discussed the website redesign timeline. No mention of partnerships here.',
    occurredAt: '2026-06-10T17:00:00Z',
  })
}

describe('Plan 06 retrieval + search', () => {
  beforeEach(() => {
    installSqliteBridge(freshDatabase())
    setModelProvider(null)
    setExtractor(null)
  })
  afterEach(() => {
    setModelProvider(null)
  })

  it('retrieves the most relevant chunk via FTS5 and degrades semantic to lexical', async () => {
    await seedCorpus()
    const result = await retrieve('partnership proposal', { mode: 'semantic' })
    expect(result.semanticAvailable).toBe(false)
    expect(result.chunks.length).toBeGreaterThan(0)
    const top = result.chunks[0]
    expect(top.recordTitle).toBe('Northwind partnership proposal')
    expect(top.snippet).toContain('[')
    expect(top.score).toBeGreaterThan(0)
  })

  it('returns nothing for an empty query and a no-hit query', async () => {
    await seedCorpus()
    expect((await retrieve('   ')).chunks).toEqual([])
    expect((await retrieve('zzzznotpresent')).chunks).toEqual([])
  })

  it('global search spans records and matches names and full text', async () => {
    await seedCorpus()
    const hits = await globalSearch('northwind')
    const kinds = new Set(hits.map((h) => h.kind))
    expect(kinds.has('document')).toBe(true)
    expect(hits.find((h) => h.kind === 'document')?.snippet).toBeTruthy()
  })

  it('global search matches an interaction by its summary, not just the body', async () => {
    // The distinctive term lives only in the summary (a digest / Granola note),
    // never in the raw transcript body or title.
    await ingestInteraction({
      kind: 'meeting',
      title: 'Kickoff',
      bodyText: 'um yeah anyway lots of filler and cross-talk',
      summary: 'Decided to ship the Babylonstoren pilot in Q3',
      occurredAt: '2026-06-11T17:00:00Z',
    })
    const hits = await globalSearch('babylonstoren')
    const interaction = hits.find((h) => h.kind === 'interaction')
    expect(interaction?.title).toBe('Kickoff')
    expect(interaction?.snippet).toBeTruthy()
  })
})

describe('Plan 06 model boundary', () => {
  beforeEach(() => {
    installSqliteBridge(freshDatabase())
    setModelProvider(null)
    setExtractor(null)
  })
  afterEach(() => setModelProvider(null))

  it('reports unavailable when no provider is configured', async () => {
    const status = await getModelStatus()
    expect(status.canRun).toBe(false)
    expect(status.configured).toBe(false)
  })

  it('can run when a provider is configured', async () => {
    setModelProvider(mockProvider(() => 'The provider answered.'))
    const status = await getModelStatus()
    expect(status.configured).toBe(true)
    expect(status.canRun).toBe(true)
  })
})

describe('Plan 06 model-backed extractor', () => {
  beforeEach(() => {
    installSqliteBridge(freshDatabase())
    setModelProvider(null)
    setExtractor(null)
  })
  afterEach(() => setModelProvider(null))

  it('feeds the 05a apply pipeline from model JSON through the boundary', async () => {
    const meeting = await ingestInteraction({
      kind: 'meeting',
      title: 'Intro call',
      bodyText: 'Met Jordan Blake from Acme Co about a pilot.',
    })
    setModelProvider(
      mockProvider(() =>
        JSON.stringify({
          people: [{ ref: 'p1', fullName: 'Jordan Blake' }],
          organizations: [{ ref: 'o1', name: 'Acme Co' }],
          affiliations: [{ personRef: 'p1', organizationRef: 'o1' }],
          memories: [{ kind: 'fact', claim: 'Jordan is exploring a pilot', subjects: [{ ref: 'p1' }] }],
        }),
      ),
    )
    setExtractor(createModelExtractor())
    const summary = await runExtraction('interaction', meeting.id)
    expect(summary).not.toBeNull()
    const people = await listPeople()
    expect(people.find((p) => p.fullName === 'Jordan Blake')).toBeTruthy()
  })

  it('is a safe no-op when the boundary is closed', async () => {
    const meeting = await ingestInteraction({ kind: 'meeting', title: 'x', bodyText: 'y' })
    setExtractor(createModelExtractor()) // provider is null
    await expect(runExtraction('interaction', meeting.id)).rejects.toThrow(/skipped/)
  })
})

describe('Plan 06 agent report endpoints', () => {
  beforeEach(() => {
    installSqliteBridge(freshDatabase())
  })

  it('buckets tasks into a daily brief and prioritizes plan-day', async () => {
    await createTask({ title: 'Overdue thing', status: 'open', dueAt: '2020-01-01' })
    await createTask({ title: 'Due today', status: 'open', dueAt: '2026-06-17', priority: 1 })
    await createTask({ title: 'Someday', status: 'open' })
    await createTask({ title: 'Blocked', status: 'waiting' })

    const now = new Date('2026-06-17T12:00:00Z')
    const brief = await getDailyBrief({ now })
    expect(brief.date).toBe(now.toLocaleDateString('en-CA'))
    expect(brief.tasks.overdue.map((t) => t.title)).toContain('Overdue thing')
    expect(brief.tasks.today.map((t) => t.title)).toContain('Due today')
    expect(brief.counts.openTasks).toBe(4)

    const plan = await planDay({ now })
    // Overdue sorts ahead of due-today.
    expect(plan[0].title).toBe('Overdue thing')
  })

  it('reports records changed since a timestamp', async () => {
    await createTask({ title: 'Recent', status: 'open' })
    const changes = await getChangesSince('2000-01-01T00:00:00Z')
    expect(changes.find((c) => c.title === 'Recent')).toBeTruthy()
  })
})
