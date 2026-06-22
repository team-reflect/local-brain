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
  db,
  getChangesSince,
  getDailyBrief,
  getModelStatus,
  globalSearch,
  ingestDocument,
  ingestInteraction,
  listPeople,
  newId,
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

describe('retrieval filters and browse', () => {
  beforeEach(() => {
    installSqliteBridge(freshDatabase())
  })

  async function seedDated() {
    await ingestInteraction({
      kind: 'email',
      title: 'Budget email',
      bodyText: 'Please send the budget by Friday.',
      occurredAt: '2026-06-18T09:00:00Z',
    })
    await ingestInteraction({
      kind: 'meeting',
      title: 'Old sync',
      bodyText: 'Talked about the budget last quarter.',
      occurredAt: '2026-01-05T09:00:00Z',
    })
    await ingestDocument({ title: 'Spec doc', bodyText: 'The budget section of the spec.' })
  }

  it('browses recent records of a type with no query, newest first', async () => {
    await seedDated()
    const result = await retrieve('', { recordTypes: ['interaction'], sort: 'recency' })
    expect(result.chunks.length).toBeGreaterThan(0)
    expect(result.chunks.every((c) => c.recordType === 'interaction')).toBe(true)
    // Newest interaction (the June email) leads; each hit carries its record date.
    expect(result.chunks[0].recordTitle).toBe('Budget email')
    expect(result.chunks[0].recordDate).toContain('2026-06-18')
  })

  it('filters interactions by kind so "emails" excludes meetings', async () => {
    await seedDated()
    const result = await retrieve('', { recordTypes: ['interaction'], kinds: ['email'] })
    const titles = result.chunks.map((c) => c.recordTitle)
    expect(titles).toContain('Budget email')
    expect(titles).not.toContain('Old sync')
    expect(titles).not.toContain('Spec doc')
  })

  it('applies an after-date window to a keyword search', async () => {
    await seedDated()
    // "budget" matches all three records, but the January meeting predates the cutoff.
    const recent = await retrieve('budget', { after: '2026-06-01T00:00:00Z' })
    const titles = recent.chunks.map((c) => c.recordTitle)
    expect(titles).toContain('Budget email')
    expect(titles).not.toContain('Old sync')
  })

  it('includes same-day records for a date-only before bound', async () => {
    await seedDated()
    // The June email is timestamped 09:00 on the bound date; a naive string `<=`
    // against the bare date would drop it. The whole day must be inclusive.
    const upToTheEmailDay = await retrieve('budget', { before: '2026-06-18' })
    const titles = upToTheEmailDay.chunks.map((c) => c.recordTitle)
    expect(titles).toContain('Budget email')
    expect(titles).toContain('Old sync')
    // The spec doc's date falls back to its (current) updated_at, after the bound.
    expect(titles).not.toContain('Spec doc')
  })

  it('browse returns nothing when filters match no records', async () => {
    await seedDated()
    const result = await retrieve('', { recordTypes: ['task'] })
    expect(result.chunks).toEqual([])
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

  it('includes imported email context beyond the email title', async () => {
    const existingSource = await db
      .selectFrom('sources')
      .select('id')
      .where('slug', '=', 'gmail')
      .executeTakeFirst()
    const sourceId = existingSource?.id ?? newId()
    if (!existingSource) {
      await db
        .insertInto('sources')
        .values({ id: sourceId, slug: 'gmail', name: 'Gmail' })
        .execute()
    }
    const personId = newId()
    await db
      .insertInto('people')
      .values({ id: personId, fullName: 'Maya Chen', headline: 'Vendor partner' })
      .execute()
    const interaction = await ingestInteraction({
      kind: 'email',
      title: 'Gmail: Partner launch update',
      summary: 'Maya sent launch timing and credential readiness updates.',
      bodyText:
        'Maya says the launch window is Thursday, credentials are ready, and Alex should review the revised onboarding note before the check-in.',
      occurredAt: '2026-06-17T16:00:00Z',
    })
    await db
      .updateTable('interactions')
      .set({ updatedAt: '2026-06-17T17:00:00.000Z' })
      .where('id', '=', interaction.id)
      .execute()
    await db
      .insertInto('externalIdentities')
      .values({
        id: newId(),
        entityType: 'interaction',
        entityId: interaction.id,
        sourceId,
        kind: 'thread',
        externalId: 'thr-1',
      })
      .execute()
    await db
      .insertInto('interactionParticipants')
      .values({
        id: newId(),
        interactionId: interaction.id,
        personId,
        role: 'from',
        handle: 'maya@example.com',
      })
      .execute()
    await createTask({ title: 'Waiting on vendor reply', status: 'waiting' })

    const briefNow = new Date('2026-06-17T18:00:00Z')
    const brief = await getDailyBrief({ now: briefNow })
    expect(brief.generatedAt).toBe(briefNow.toISOString())
    const email = brief.recentInteractions.find((item) => item.id === interaction.id)
    expect(email?.source?.slug).toBe('gmail')
    expect(email?.participants.map((participant) => participant.name)).toContain('Maya Chen')
    expect(email?.summary).toContain('launch timing')
    expect(email?.excerpt).toContain('credentials are ready')
    expect(brief.waitingItems.map((task) => task.title)).toContain('Waiting on vendor reply')
    expect(brief.recentChanges.some((change) => change.kind === 'interaction')).toBe(true)
    expect(brief.relationshipContext.some((context) => context.name === 'Maya Chen')).toBe(true)

    const futureBrief = await getDailyBrief({ now: new Date('2036-01-01T18:00:00Z') })
    expect(futureBrief.date).toBe('2036-01-01')
    expect(futureBrief.recentChanges.some((change) => change.id === interaction.id)).toBe(false)
  })

  it('reports records changed since a timestamp', async () => {
    await createTask({ title: 'Recent', status: 'open' })
    await db
      .insertInto('tasks')
      .values({
        id: newId(),
        title: 'Archived recent task',
        status: 'open',
        archivedAt: '2026-06-17T12:00:00.000Z',
      })
      .execute()
    const changes = await getChangesSince('2000-01-01T00:00:00Z')
    expect(changes.find((c) => c.title === 'Recent')).toBeTruthy()
    expect(changes.find((c) => c.title === 'Archived recent task')).toBeUndefined()
  })
})
